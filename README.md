# IO SelfCare - Import Adesioni

We are migrating our subscription base (`Adesioni`) toward our new `SelfCare` portal. This is a tool meant to process in a batch execution our actual codebase.

<details><summary>Dictionary</summary>
Due to the nature of the project, it's been easier for us to use Italian words for domain concepts

* `Adesione` / `Adesioni` - An entity representing the subscription of an Organization to IO; it includes the Organization's id and all its contracts
* `Ente` / `Enti` - Organizations
* `Allegato` / `Allegati` - Attachments
</details>

----

More details: https://pagopa.atlassian.net/wiki/spaces/IOPAE/pages/608469545/

## Local HTTP smoke test

The existing Compose file starts the official Cosmos DB vNext emulator and
Azurite. Functions run on the host using the repository's Node version. No Azure
subscription, production credentials, or real SelfCare endpoint are required.

Prerequisites: Docker with Compose 2.24 or newer, Node 16.9.1 (selected by
`.node-version`), and Azure Functions Core Tools v4. Node 16 is end-of-life; this
setup reproduces the existing application and is for local testing only.

### 1. Install, build, and start the emulators

Run from the repository root:

```sh
npm exec --yes --package=yarn@1.22.22 -- yarn install --frozen-lockfile --non-interactive
npm run build
docker compose up -d --wait --wait-timeout 180
node docker/local/run.cjs seed
```

The seed creates database `importadesioni-local`, with containers `memberships`,
`contracts`, and `pecDelegato`, using the application's partition keys. It upserts
two fake institutions: `ente_test` (fiscal code `00000000000`) for the happy path
and a second institution (fiscal code `00000000001`) for the negative encoding test.
Each has a V2.3 contract and shares the fake manager
`mario.rossi@example.com`. Both memberships start as `Initial`.
Re-running the seed resets only these fixture documents; it does not delete the
database. The attachment path is fictitious: this importer sends metadata, not
file contents.

Cosmos uses HTTPS. The seed exports the public emulator CA from its container to
the ignored `.local-functions/` directory. Only the local test clients and
Functions worker trust this additional CA; TLS verification remains enabled.
Run the seed again after recreating Cosmos, then restart Functions if its
certificate changed. Emulator ports are bound to loopback only.

### 2. Start the application

In a terminal that stays open:

```sh
node docker/local/run.cjs start
```

Wait for the HTTP endpoints to appear in the Functions output. The first start
can take longer while Core Tools downloads the extension bundle. The launcher
creates an isolated runtime directory with copies of the selected bindings,
links to the real compiled code, and local-only settings. It does not read or
overwrite the repository's `.env` or `local.settings.json`.

### 3. Run the happy path

In another terminal, from the repository root:

```sh
curl -i http://127.0.0.1:7071/admin/host/status
node docker/local/run.cjs check
```

`check` sends this request, verifies `202 Accepted` and the selected IPA code,
then waits up to 90 seconds for the membership to become `Processed` in Cosmos:

```sh
curl -i -X POST 'http://127.0.0.1:7071/api/v1/start?ipas=ente_test&status=Initial'
```

Use only one of `check`, the manual POST, or the Bruno Start Import request per
seed. The request only starts asynchronous processing; `202` alone is not proof
of a successful import.
The Functions log should show `ProcessMembership` and `SelfcareMock`, with a mock
response of `201`. A successful automated check ends with:

```text
PASS: HTTP -> Cosmos -> Azurite queue -> worker -> SelfcareMock -> Processed
```

Cosmos Data Explorer is available at <http://localhost:1234>. Inspect
`importadesioni-local` / `memberships` / `ente_test` for the final `status` and
`note`. To repeat the test after the previous invocation has finished, re-run
`seed`, then `check`.

### 4. Run the same flow with Bruno

The [Bruno collection](bruno/bruno.json) contains the same HTTP calls as the curl
examples, with response tests and a [Local environment](bruno/environments/Local.bru).
It uses only the local Functions host; no credentials or real SelfCare service
are needed. Bruno does not start Docker, run the seed, or launch Functions.

1. Complete steps 1 and 2 above. Before repeating an import, wait for the previous
	invocation to finish and run `node docker/local/run.cjs seed` again.
2. In Bruno, choose **Open Collection**, select the repository's `bruno` directory,
	and select the **Local** environment.
3. Send [Runtime Status](bruno/01%20-%20Runtime%20Status.bru). Its test expects HTTP
	`200` and `state: Running`.
4. Send [Start Import](bruno/02%20-%20Start%20Import.bru). Its test expects HTTP
	`202` and an array containing `ente_test`. Do not run `check` or the manual
	POST on the same seed.
5. In [Cosmos Data Explorer](http://localhost:1234), open `importadesioni-local` /
	`memberships` / `ente_test`. Wait for `status: Processed` and
	`note: Successful imported | contract id#contratto-test`. The Functions
	terminal should show `ProcessMembership` and the successful `SelfcareMock`
	invocation. This completes the asynchronous happy path.

The environment defaults are `baseUrl=http://127.0.0.1:7071`, `ipaCode=ente_test`,
and `membershipStatus=Initial`. A `202` response with `[]` does not exercise the
worker: it means no eligible membership matched, and the Bruno test fails.
Re-seed before retrying. Running the collection in sequence submits the happy
path and the negative fixture described below, but final Cosmos verification is
still required. No background polling scripts are included in the collection.

The collection also provides an [Info request](bruno/03%20-%20Info.bru) for
`GET /api/v1/info`. When healthy, the endpoint returns HTTP `200` with the
application `name` and `version`, checked by the request's test. Unlike Runtime
Status, Info checks the configured dependencies, not just the Functions host.
The local launcher uses [a local adapter](docker/local/info.cjs) that reuses the
real `InfoHandler` and checks Cosmos DB plus Azurite Blob, Queue, and Table.
Only Azure Files is excluded because Azurite does not implement it; the
production health check is unchanged. Dependency/configuration errors produce
HTTP `500`, not a simulated success. If a previously started launcher returns
`404`, stop it and run `node docker/local/run.cjs start` again to regenerate the
local bindings and enable Info. The Info request itself does not enqueue an
import; the normal emulator/certificate setup must already be complete.

### 5. Verify response rejection with Bruno

After rebuilding, seeding, and restarting the updated local launcher, use the
**Local** environment and send
[Start Response Rejection](bruno/04%20-%20Start%20Response%20Rejection.bru).
It selects the negative fixture configured in the Local environment. Do not
also submit the same negative fixture through the command-line checker.
The normal and negative fixtures are separate, so each can be submitted once
after a single seed.

The request must return `202` with an array containing the selected IPA code.
The local-only
[SelfCare mock adapter](docker/local/selfcare-mock.cjs) returns an ordinary
compressed JSON response with a non-identity `Content-Encoding` for this institution,
ignoring the worker's `Accept-Encoding: identity`. This is a safe regression
fixture, not an exploit payload. The production SelfcareMock is unchanged.

In Cosmos Data Explorer, inspect `importadesioni-local` / `memberships` /
the IPA code returned by the request. The expected outcome is **Failed**, with a
`note` containing `Unsupported Content-Encoding`. **Processed is a failed rejection test** for this
fixture. The mock's Functions log also records the received `Accept-Encoding`.
The worker's existing error handling records the rejection without crashing or
changing the normal `201`/`409` success rules for uncompressed responses.

Alternatively, instead of the happy-path Bruno POST, run this bounded check in
a second terminal while the app is running:

```sh
node docker/local/run.cjs check
```

The check submits one fixture and exits after success or a 90-second wait.
Stop the launcher with Ctrl+C and run `docker compose down` after testing.
No additional daemon or polling process is started by the check.

Changing `Accept-Encoding` on the incoming Bruno request is not an equivalent
test. Response validation applies to the **downstream response** received by the
SelfCare HTTP client, not the incoming import request.

## HTTP response handling

The verified local stack uses Node 16.9.1 and node-fetch 2.6.8.
No runtime, package version, or lockfile is changed here.

The [existing SelfCare transport](utils/selfcare.ts) now sends
`Accept-Encoding: identity`, forces node-fetch's `compress: false`, and rejects
any explicit `Content-Encoding` other than a single `identity` token before the
generated client consumes the response. Missing encoding is accepted as-is;
compressed bytes with absent/misleading encoding are never guessed or decoded.
The transport preserves request options, authentication, cancellation, and body
stream cleanup. Merely requesting identity without disabling automatic
decompression would not protect against a server that ignores the request.

This intentionally rejects gzip/deflate and unknown or ambiguous encodings too.
Before rollout, verify that SelfCare and any intervening proxies honor identity.
An encoded response, including a `201` or `409`, now follows the existing failure
path rather than being accepted. No business selection/delegate/version rules
are modified.

This is a defense-in-depth mitigation for the direct SelfCare HTTP path, **not a
replacement for upgrading vulnerable runtimes/libraries**. It does not patch
Node's embedded libraries or cover every HTTP consumer inside transitive
Azure SDK/common-library dependencies. Node 16 is end-of-life; a supported,
vendor-patched runtime remains necessary for full remediation.

The [transport tests](utils/__tests__/selfcare.test.ts) exercise real, temporary
loopback HTTP servers with guaranteed cleanup. They instrument the four public
decompression entry points, demonstrate the default node-fetch behavior,
then verify no decoder calls on protected paths, including redirects,
concurrency, malformed headers, body cancellation, and worker state updates.
Only benign compressed data is used. Coverage before mitigation was zero for
the wrapper; added pre-patch contract tests reached 94.7% line coverage. The
mitigated wrapper reaches 100% lines and at least 95% branches. Coverage of the
unmodified business-rule branches is not claimed to be complete.

```sh
npm test -- --runInBand --coverage --collectCoverageFrom='utils/selfcare.ts' --coverageThreshold='{"./utils/selfcare.ts":{"lines":100,"branches":95,"functions":90,"statements":95}}'
npm run build
```

### Scope and troubleshooting

- This test exercises the real HTTP handler, Cosmos DAO, Storage queue binding,
	membership worker, and the repository's HTTP SelfCare mock.
- `OnContractChange` is intentionally excluded: the seed supplies already
	normalized data. Change feed processing, IPA CSV ingestion, real SelfCare
	behavior, authentication, and production networking are not covered.
- The local `Info` adapter checks Cosmos DB and Azurite Blob, Queue, and Table,
	but not unsupported Azure Files. `/admin/host/status` checks runtime readiness;
	`check` verifies an actual import. Production health checks are unchanged.
- The second Azurite service is available with `docker compose --profile
	extra-storage up -d`. It is not needed for this smoke test.
- The old Functions and Traefik services remain under the `legacy` profile for
	reference. They have not been modernized or validated; do not enable that
	profile for this procedure. The old Dockerfiles are not used by default.
- If a port is occupied, stop the conflicting local service first. This setup
	uses ports 7071, 8081, 1234, and 10000-10002.
- For startup or emulator failures: `docker compose ps` and
	`docker compose logs --tail 100 cosmosdb fnstorage`. For queue/worker failures,
	inspect the Functions terminal and the membership's `note` in Cosmos.
- The Cosmos vNext image is a preview and does not enforce authentication.
	Its `vnext-latest` tag can change; emulator behavior is not a production
	compatibility guarantee.

Stop Functions with Ctrl+C, then stop the emulators (preserving their data):

```sh
docker compose down
```

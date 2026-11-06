const assert = require("assert").strict;
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn, execFileSync } = require("child_process");
const { CosmosClient } = require("@azure/cosmos");
const fetch = require("node-fetch");

const root = path.resolve(__dirname, "../..");
const runtime = path.join(root, ".local-functions");
const endpoint = "https://localhost:8081";
const certificatePath = path.join(runtime, "cosmos-emulator.pem");
const key = Buffer.from("local-emulator-only").toString("base64");
const databaseName = "importadesioni-local";
const baseUrl = "http://127.0.0.1:7071";
const ipaCode = "ente_test";
const brotliIpaCode = "ente_brotli_test";
const fiscalCode = "00000000000";
const storageConnectionString = [
  "DefaultEndpointsProtocol=http",
  "AccountName=devstoreaccount1",
  "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1",
  "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1",
  "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1"
].join(";");
let client;
let database;

const functions = [
  "Info",
  "StartProcess",
  "ProcessMembership",
  "OnFailedProcessMembership",
  "SelfcareMock"
];

const values = {
  FUNCTIONS_WORKER_RUNTIME: "node",
  "AzureWebJobs.Info.Disabled": "false",
  AzureWebJobsStorage: storageConnectionString,
  INTERNAL_STORAGE_CONNECTION_STRING: storageConnectionString,
  INTERNAL_STORAGE_FALLBACK_CONNECTION_STRING: storageConnectionString,
  COSMOSDB_URI: endpoint,
  COSMOSDB_KEY: key,
  COSMOSDB_NAME: databaseName,
  IPA_OPEN_DATA_STORAGE_PATH: "ipa/unused-in-this-smoke-test.csv",
  SELFCARE_URL: `${baseUrl}/api/v1`,
  SELFCARE_KEY: "local-mock-only",
  NODE_ENV: "development"
};

async function exportLocalCertificate() {
  fs.mkdirSync(runtime, { recursive: true });
  const certificate = execFileSync("docker", [
    "compose", "-f", path.join(root, "docker-compose.yml"),
    "exec", "-T", "cosmosdb", "cat", "/scripts/certs/rootCA.crt"
  ], {
    encoding: "utf8",
    timeout: 10000
  });
  fs.writeFileSync(certificatePath, certificate);
}

async function seed() {
  await client.databases.createIfNotExists({ id: databaseName });
  for (const [id, partitionKey] of [
    ["memberships", "/ipaCode"],
    ["contracts", "/ipaCode"],
    ["pecDelegato", "/IDALLEGATO"]
  ]) {
    await database.containers.createIfNotExists({ id, partitionKey });
  }
  const contract = {
    id: "contratto-test",
    ipaCode,
    emailDate: "2021-12-06T17:33:40.000Z",
    version: "V2.3",
    isAggregator: false,
    attachment: {
      id: "allegato-test",
      kind: "Contratto",
      name: "contratto-test.p7m",
      path: "contratti-test/contratto-test.p7m"
    }
  };
  await database.container("contracts").items.upsert(contract);
  await database.container("contracts").items.upsert({
    ...contract,
    id: "contratto-brotli-test",
    ipaCode: brotliIpaCode
  });
  await database.container("pecDelegato").items.upsert({
    id: "delegato-test",
    IDALLEGATO: "allegato-test",
    CODICEFISCALE: "RSSMRA80A01H501U",
    EMAIL: "mario.rossi@example.com",
    NOMINATIVO: "Mario Rossi",
    TIPODELEGATO: "Principale"
  });
  await database.container("memberships").items.upsert({
    id: ipaCode,
    ipaCode,
    fiscalCode,
    mainInstitution: true,
    status: "Initial"
  });
  console.log(`Seed ready: ${databaseName}/memberships/${ipaCode} = Initial`);
  await database.container("memberships").items.upsert({
    id: brotliIpaCode,
    ipaCode: brotliIpaCode,
    fiscalCode: "00000000001",
    mainInstitution: true,
    status: "Initial"
  });
  console.log(`Seed ready: ${databaseName}/memberships/${brotliIpaCode} = Initial (Brotli rejection)`);
}

function start() {
  assert(fs.existsSync(path.join(root, "dist/StartProcess/index.js")),
    "Run npm run build before starting the local app");
  assert(fs.existsSync(certificatePath), "Run the seed command before starting the local app");
  fs.mkdirSync(runtime, { recursive: true });
  for (const directory of ["dist", "node_modules"]) {
    const target = path.join(runtime, directory);
    if (!fs.existsSync(target)) {
      fs.symlinkSync(path.join(root, directory), target, "dir");
    }
  }
  for (const name of functions) {
    fs.mkdirSync(path.join(runtime, name), { recursive: true });
    const binding = JSON.parse(fs.readFileSync(path.join(root, name, "function.json"), "utf8"));
    if (name === "Info") {
      binding.scriptFile = "../../docker/local/info.cjs";
    }
    if (name === "SelfcareMock") {
      binding.scriptFile = "../../docker/local/selfcare-mock.cjs";
    }
    fs.writeFileSync(path.join(runtime, name, "function.json"), JSON.stringify(binding, null, 2));
  }
  const host = JSON.parse(fs.readFileSync(path.join(root, "host.json"), "utf8"));
  host.logging.logLevel.default = "Information";
  delete host.extensions.extensionBundle;
  host.extensionBundle = {
    id: "Microsoft.Azure.Functions.ExtensionBundle",
    version: "[3.*, 4.0.0)"
  };
  fs.writeFileSync(path.join(runtime, "host.json"), JSON.stringify(host, null, 2));
  fs.writeFileSync(path.join(runtime, "package.json"), JSON.stringify({
    name: "importadesioni-local-smoke-test",
    private: true,
    version: "1.0.0"
  }, null, 2));
  fs.writeFileSync(path.join(runtime, "local.settings.json"), JSON.stringify({
    IsEncrypted: false,
    Values: values
  }, null, 2));
  const child = spawn("func", ["start", "--port", "7071"], {
    cwd: runtime,
    env: { ...process.env, ...values, NODE_EXTRA_CA_CERTS: certificatePath },
    stdio: "inherit"
  });
  child.on("error", error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", code => { process.exitCode = code || 0; });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}

async function check(rejectBrotli = false) {
  const selectedIpaCode = rejectBrotli ? brotliIpaCode : ipaCode;
  const expectedStatus = rejectBrotli ? "Failed" : "Processed";
  const expectedNote = rejectBrotli ? "Unsupported Content-Encoding" : "Successful imported";
  const before = await database.container("memberships").item(selectedIpaCode, selectedIpaCode).read();
  assert.equal(before.resource.status, "Initial", "Run the seed command before each smoke test");
  const response = await fetch(`${baseUrl}/api/v1/start?ipas=${selectedIpaCode}&status=Initial`, {
    method: "POST",
    timeout: 10000
  });
  const body = await response.text();
  console.log(`POST /api/v1/start -> ${response.status}\n${body}`);
  assert.equal(response.status, 202);
  assert(body.includes(selectedIpaCode), "The HTTP response must include the seeded membership");
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const { resource } = await database.container("memberships").item(selectedIpaCode, selectedIpaCode).read();
    if (resource.status !== "Initial") {
      console.log(JSON.stringify({ ipaCode: resource.ipaCode, status: resource.status, note: resource.note }, null, 2));
      assert.equal(resource.status, expectedStatus);
      assert(resource.note.includes(expectedNote));
      console.log(rejectBrotli
        ? "PASS: Brotli response rejected -> Failed with Unsupported Content-Encoding"
        : "PASS: HTTP -> Cosmos -> Azurite queue -> worker -> SelfcareMock -> Processed");
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${expectedStatus}; inspect the Functions terminal and poison queue`);
}

async function main() {
  const command = process.argv[2];
  if (["seed", "check", "check-brotli"].includes(command)) {
    if (command === "seed") {
      await exportLocalCertificate();
    }
    client = new CosmosClient({
      endpoint,
      key,
      agent: new https.Agent({ ca: fs.readFileSync(certificatePath) })
    });
    database = client.database(databaseName);
  }
  if (command === "seed") {
    await seed();
  } else if (command === "start") {
    start();
  } else if (command === "check") {
    await check();
  } else if (command === "check-brotli") {
    await check(true);
  } else {
    throw new Error("Usage: node docker/local/run.cjs seed|start|check|check-brotli");
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
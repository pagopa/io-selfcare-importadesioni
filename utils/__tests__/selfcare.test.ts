import { Context } from "@azure/functions";
import * as E from "fp-ts/lib/Either";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { AddressInfo, Socket } from "net";
import nodeFetch, { Headers, Request, RequestInit, Response } from "node-fetch";
import { PassThrough } from "stream";
import * as zlib from "zlib";
import {
    dao,
    mockFeedResponse,
    mockReadAllItemsByQuery,
    mockReadItemById,
    mockUpsert
} from "../../__mocks__/dao";
import createMembershipHandler from "../../ProcessMembership/handler";
import { createClient, createUncompressedFetch } from "../selfcare";

const json = JSON.stringify({ ok: true });
const brotliBody = zlib.brotliCompressSync(json);
const decoderCalls: string[] = [];
const decoderDescriptors = new Map<string, PropertyDescriptor>();
const signalOf = (
  controller: AbortController
): NonNullable<RequestInit["signal"]> =>
  (controller.signal as unknown) as NonNullable<RequestInit["signal"]>;

beforeAll(() => {
  for (const name of [
    "createBrotliDecompress",
    "BrotliDecompress",
    "brotliDecompress",
    "brotliDecompressSync"
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(zlib, name);
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error(`Missing Brotli entry point: ${name}`);
    }
    decoderDescriptors.set(name, descriptor);
    Object.defineProperty(zlib, name, {
      ...descriptor,
      value: new Proxy(descriptor.value, {
        apply(target, receiver, args) {
          decoderCalls.push(name);
          return Reflect.apply(target, receiver, args);
        },
        construct(target, args, newTarget) {
          decoderCalls.push(name);
          return Reflect.construct(target, args, newTarget);
        }
      })
    });
  }
});

afterAll(() => {
  decoderDescriptors.forEach((descriptor, name) =>
    Object.defineProperty(zlib, name, descriptor)
  );
});

const withLocalServer = async (
  respond: (request: IncomingMessage, response: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>
): Promise<void> => {
  const sockets = new Set<Socket>();
  const server = createServer(respond);
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
      sockets.forEach(socket => socket.destroy());
    });
  }
};

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(decoderCalls).toEqual([]);
  jest.restoreAllMocks();
});

describe("SelfCare HTTP client contract", () => {
  it.each([201, 409])(
    "preserves the onboarding request and status %s",
    async status => {
      const observed = jest.fn();
      const claim = {
        externalInstitutionId: "00000000000",
        body: {
          importContract: {
            contractType: "V2.3",
            fileName: "contratto-test.p7m",
            filePath: "test/contratto-test.p7m",
            onboardingDate: new Date("2021-12-06T17:33:40.000Z")
          },
          users: []
        }
      };
      await withLocalServer(
        (request, response) => {
          const chunks: Buffer[] = [];
          request.on("data", chunk => chunks.push(Buffer.from(chunk)));
          request.on("end", () => {
            observed(
              request.method,
              request.url,
              request.headers,
              JSON.parse(Buffer.concat(chunks).toString())
            );
            response.writeHead(status, { "Content-Type": "application/json" });
            response.end(
              status === 409
                ? JSON.stringify({ status: 409, title: "Already onboarded" })
                : undefined
            );
          });
        },
        async baseUrl => {
          const result = await createClient(
            baseUrl,
            "fake-api-key"
          ).contractOnboardingUsingPOST(claim);
          expect(E.isRight(result)).toBe(true);
          if (E.isRight(result)) {
            expect(result.right.status).toBe(status);
          }
        }
      );
      expect(observed).toHaveBeenCalledWith(
        "POST",
        "/onboarding/00000000000",
        expect.objectContaining({ "content-type": "application/json" }),
        JSON.parse(JSON.stringify(claim.body))
      );
      expect(observed.mock.calls[0][2]).toEqual(
        expect.objectContaining({
          ["Ocp-Apim-Subscription-Key".toLowerCase()]: "fake-api-key",
          "accept-encoding": "identity"
        })
      );
    }
  );
});

describe("uncompressed SelfCare transport", () => {
  it("observes the decoder in the unprotected client but never in the protected one", async () => {
    await withLocalServer(
      (_request, response) => {
        response.writeHead(200, { "Content-Encoding": "br" });
        response.end(brotliBody);
      },
      async baseUrl => {
        const baseline = await nodeFetch(baseUrl);
        expect(await baseline.json()).toEqual({ ok: true });
        expect(decoderCalls).toEqual(["createBrotliDecompress"]);
        decoderCalls.length = 0;
        await expect(createUncompressedFetch()(baseUrl)).rejects.toThrow(
          "Unsupported Content-Encoding"
        );
      }
    );
  });

  it.each([undefined, "identity", "IDENTITY"])(
    "accepts plain JSON with encoding %s",
    async encoding => {
      const observed = jest.fn();
      await withLocalServer(
        (request, response) => {
          observed(request.headers["accept-encoding"]);
          if (encoding !== undefined) {
            response.setHeader("Content-Encoding", encoding);
          }
          response.end(json);
        },
        async baseUrl => {
          expect(
            await (await createUncompressedFetch()(baseUrl)).json()
          ).toEqual({ ok: true });
        }
      );
      expect(observed).toHaveBeenCalledWith("identity");
    }
  );

  it.each([
    "br",
    "gzip",
    "x-gzip",
    "deflate",
    "zstd",
    "",
    "bad token",
    "identity, br",
    "identity, identity"
  ])("rejects encoding %s without decoding", async encoding => {
    await withLocalServer(
      (_request, response) => {
        response.writeHead(200, { "Content-Encoding": encoding });
        response.end(brotliBody);
      },
      async baseUrl => {
        await expect(createUncompressedFetch()(baseUrl)).rejects.toThrow(
          "Unsupported Content-Encoding"
        );
      }
    );
  });

  it.each([201, 204, 304, 400, 409, 500])(
    "rejects compressed status %s before consumer decoding",
    async status => {
      await withLocalServer(
        (_request, response) => {
          response.writeHead(status, { "Content-Encoding": "br" });
          response.end(brotliBody);
        },
        async baseUrl => {
          await expect(createUncompressedFetch()(baseUrl)).rejects.toThrow(
            "Unsupported Content-Encoding"
          );
        }
      );
    }
  );

  it.each([undefined, "identity"])(
    "never guesses Brotli from bytes or Content-Type with encoding %s",
    async encoding => {
      await withLocalServer(
        (_request, response) => {
          response.writeHead(200, {
            "Content-Type": "application/brotli",
            ...(encoding === undefined ? {} : { "Content-Encoding": encoding })
          });
          response.end(brotliBody);
        },
        async baseUrl => {
          const response = await createUncompressedFetch()(baseUrl);
          expect(await response.clone().buffer()).toEqual(brotliBody);
          await expect(response.json()).rejects.toMatchObject({
            type: "invalid-json"
          });
        }
      );
    }
  );

  it("rejects duplicate Content-Encoding headers and HEAD responses", async () => {
    await withLocalServer(
      (_request, response) => {
        response.setHeader("Content-Encoding", ["identity", "br"]);
        response.end();
      },
      async baseUrl => {
        await expect(
          createUncompressedFetch()(baseUrl, { method: "HEAD" })
        ).rejects.toThrow("Unsupported Content-Encoding");
      }
    );
  });

  it("keeps compression disabled across followed and manual redirects", async () => {
    const observed = jest.fn();
    await withLocalServer(
      (request, response) => {
        observed(request.url, request.headers["accept-encoding"]);
        response.writeHead(request.url === "/start" ? 302 : 200, {
          "Content-Encoding": "br",
          ...(request.url === "/start" ? { Location: "/target" } : {})
        });
        response.end(brotliBody);
      },
      async baseUrl => {
        await expect(
          createUncompressedFetch()(`${baseUrl}/start`)
        ).rejects.toThrow("Unsupported Content-Encoding");
        await expect(
          createUncompressedFetch()(`${baseUrl}/start`, { redirect: "manual" })
        ).rejects.toThrow("Unsupported Content-Encoding");
      }
    );
    expect(observed.mock.calls).toEqual([
      ["/start", "identity"],
      ["/target", "identity"],
      ["/start", "identity"]
    ]);
  });

  it("overrides caller compression without mutating headers or losing request options", async () => {
    const injected = jest.fn(
      async () => new Response(undefined, { status: 204 })
    );
    const headers = { "Accept-Encoding": "br", "X-Test": "preserved" };
    await createUncompressedFetch(injected)("https://example.invalid", {
      method: "POST",
      body: "payload",
      headers,
      compress: true,
      redirect: "manual"
    });
    expect(injected).toHaveBeenCalledWith(
      "https://example.invalid",
      expect.objectContaining({
        method: "POST",
        body: "payload",
        compress: false,
        redirect: "manual"
      })
    );
    const options = ((injected.mock.calls as unknown) as ReadonlyArray<
      readonly [unknown, RequestInit]
    >)[0][1];
    const actualHeaders = new Headers(options.headers);
    expect(actualHeaders.get("accept-encoding")).toBe("identity");
    expect(actualHeaders.get("x-test")).toBe("preserved");
    expect(headers["Accept-Encoding"]).toBe("br");
  });

  it("inherits headers and cancellation from a node-fetch Request", async () => {
    const caller = new AbortController();
    const request = new Request("https://example.invalid", {
      signal: signalOf(caller),
      headers: { "Accept-Encoding": "br", "X-Test": "request" }
    });
    const remove = jest.spyOn(caller.signal, "removeEventListener");
    const injected = jest.fn(
      async () => new Response(undefined, { status: 204 })
    );
    await createUncompressedFetch(injected)(request);
    const options = ((injected.mock.calls as unknown) as ReadonlyArray<
      readonly [unknown, RequestInit]
    >)[0][1];
    expect(new Headers(options.headers).get("x-test")).toBe("request");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not send an already cancelled request", async () => {
    const observed = jest.fn();
    const caller = new AbortController();
    caller.abort();
    await withLocalServer(observed, async baseUrl => {
      await expect(
        createUncompressedFetch()(baseUrl, { signal: signalOf(caller) })
      ).rejects.toMatchObject({ name: "AbortError" });
    });
    expect(observed).not.toHaveBeenCalled();
  });

  it("honors cancellation before headers and releases the listener", async () => {
    const caller = new AbortController();
    const remove = jest.spyOn(caller.signal, "removeEventListener");
    let notify: () => void = () => undefined;
    const started = new Promise<void>(resolve => {
      notify = resolve;
    });
    await withLocalServer(
      () => notify(),
      async baseUrl => {
        const pending = createUncompressedFetch()(baseUrl, {
          signal: signalOf(caller)
        });
        const rejection = expect(pending).rejects.toMatchObject({
          name: "AbortError"
        });
        await started;
        caller.abort();
        await rejection;
      }
    );
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("keeps cancellation working while the response body is being consumed", async () => {
    const caller = new AbortController();
    const remove = jest.spyOn(caller.signal, "removeEventListener");
    await withLocalServer(
      (_request, response) => {
        response.writeHead(200);
        response.write('{"ok":');
      },
      async baseUrl => {
        const response = await createUncompressedFetch()(baseUrl, {
          signal: signalOf(caller)
        });
        const rejected = expect(response.json()).rejects.toMatchObject({
          name: "AbortError"
        });
        caller.abort();
        await rejected;
      }
    );
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("closes a rejected compressed stream without aborting the caller", async () => {
    const caller = new AbortController();
    let notify: () => void = () => undefined;
    const closed = new Promise<void>(resolve => {
      notify = resolve;
    });
    await withLocalServer(
      (_request, response) => {
        response.once("close", notify);
        response.writeHead(200, { "Content-Encoding": "br" });
        response.write(brotliBody.subarray(0, 3));
      },
      async baseUrl => {
        await expect(
          createUncompressedFetch()(baseUrl, { signal: signalOf(caller) })
        ).rejects.toThrow("Unsupported Content-Encoding");
        await closed;
      }
    );
    expect(caller.signal.aborted).toBe(false);
  });

  it("releases cancellation on completed and already completed response streams", async () => {
    const caller = new AbortController();
    const remove = jest.spyOn(caller.signal, "removeEventListener");
    await withLocalServer(
      (_request, response) => response.end(json),
      async baseUrl => {
        const response = await createUncompressedFetch()(baseUrl, {
          signal: signalOf(caller)
        });
        expect(await response.json()).toEqual({ ok: true });
      }
    );
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const body = new PassThrough();
    body.end(json);
    await new Promise<void>(resolve => body.once("finish", resolve));
    remove.mockClear();
    await createUncompressedFetch(
      async () => new Response(body)
    )("https://example.invalid", { signal: signalOf(caller) });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    body.destroy();
  });

  it("never decodes under concurrent HTTP responses", async () => {
    const observed = jest.fn();
    await withLocalServer(
      (request, response) => {
        observed(request.headers["accept-encoding"]);
        response.writeHead(200, { "Content-Encoding": "br" });
        response.end(brotliBody);
      },
      async baseUrl => {
        const fetchApi = createUncompressedFetch();
        await Promise.all(
          Array.from({ length: 30 }, () =>
            expect(fetchApi(baseUrl)).rejects.toThrow(
              "Unsupported Content-Encoding"
            )
          )
        );
      }
    );
    expect(observed).toHaveBeenCalledTimes(30);
    expect(
      observed.mock.calls.every(([encoding]) => encoding === "identity")
    ).toBe(true);
  });
});

describe("membership processing with the real protected HTTP client", () => {
  it.each([
    { status: 201, encoding: undefined, expected: "Processed" },
    { status: 409, encoding: undefined, expected: "Processed" },
    { status: 201, encoding: "br", expected: "Failed" }
  ])(
    "marks $status / $encoding as $expected without changing the business flow",
    async ({ status, encoding, expected }) => {
      const membership = {
        id: "ente_test",
        ipaCode: "ente_test",
        fiscalCode: "00000000000",
        mainInstitution: true,
        status: "Initial"
      };
      const contract = {
        id: "contratto-test",
        ipaCode: "ente_test",
        isAggregator: false,
        emailDate: "2021-12-06T17:33:40.000Z",
        version: "V2.3",
        attachment: {
          id: "allegato-test",
          kind: "Contratto",
          name: "test.p7m",
          path: "test/test.p7m"
        }
      };
      dao.mockImplementation(() => ({
        readAllItemsByQuery: mockReadAllItemsByQuery,
        readItemsByQuery: jest.fn(),
        readItemById: mockReadItemById,
        upsert: mockUpsert
      }));
      mockReadAllItemsByQuery
        .mockReset()
        .mockResolvedValueOnce(mockFeedResponse([contract]))
        .mockResolvedValueOnce(
          mockFeedResponse([
            {
              id: "delegato-test",
              IDALLEGATO: "allegato-test",
              CODICEFISCALE: "RSSMRA80A01H501U",
              EMAIL: "mario.rossi@example.com",
              NOMINATIVO: "Mario Rossi",
              TIPODELEGATO: "Principale"
            }
          ])
        );
      mockReadItemById.mockReset().mockResolvedValue({ resource: membership });
      mockUpsert.mockReset().mockResolvedValue({ statusCode: 200 });
      const context = ({ log: { error: jest.fn() } } as unknown) as Context;
      await withLocalServer(
        (_request, response) => {
          response.writeHead(status, {
            "Content-Type": "application/json",
            ...(encoding ? { "Content-Encoding": encoding } : {})
          });
          response.end(
            encoding
              ? brotliBody
              : status === 409
              ? JSON.stringify({ status: 409, title: "Already onboarded" })
              : undefined
          );
        },
        async baseUrl => {
          const handler = createMembershipHandler({
            dao,
            selfcareClient: createClient(baseUrl, "fake-key")
          });
          await expect(
            handler(context, {
              ipaCode: membership.ipaCode,
              fiscalCode: membership.fiscalCode
            })
          ).resolves.toBeUndefined();
        }
      );
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith({
        ...membership,
        status: expected,
        note: expect.stringContaining(
          encoding ? "Unsupported Content-Encoding" : "Successful imported"
        )
      });
    }
  );
});

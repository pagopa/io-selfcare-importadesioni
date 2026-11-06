import nodeFetch, { Headers, Request, RequestInit } from "node-fetch";
import { PassThrough, Readable } from "stream";
import {
  Client,
  createClient as createClientBase
} from "../generated/selfcare/client";

type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types
} & {};

export type SelfCareClient = Prettify<Client<"apiKeyHeader">>;

type Fetch = (
  ...args: Parameters<typeof nodeFetch>
) => ReturnType<typeof nodeFetch>;

const releaseOnBodyCompletion = (body: Readable, release: () => void): void => {
  const onCompletion = (): void => {
    body.removeListener("end", onCompletion);
    body.removeListener("finish", onCompletion);
    body.removeListener("close", onCompletion);
    body.removeListener("error", onCompletion);
    release();
  };
  body.once("end", onCompletion);
  body.once("finish", onCompletion);
  body.once("close", onCompletion);
  body.once("error", onCompletion);
  if (
    body.destroyed ||
    (body instanceof PassThrough && body.writableFinished)
  ) {
    onCompletion();
  }
};

export const createUncompressedFetch = (
  fetchApi: Fetch = nodeFetch
): Fetch => async (input, init): ReturnType<typeof nodeFetch> => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
  headers.set("Accept-Encoding", "identity");
  const request =
    input instanceof Request
      ? (input as Request & { readonly signal?: RequestInit["signal"] })
      : undefined;
  const callerSignal = init && "signal" in init ? init.signal : request?.signal;
  const controller = new AbortController();
  const forwardAbort = (): void => {
    controller.abort();
  };
  const release = (): void => {
    callerSignal?.removeEventListener("abort", forwardAbort);
  };
  if (callerSignal?.aborted) {
    forwardAbort();
  } else {
    callerSignal?.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    const response = await fetchApi(input, {
      ...init,
      compress: false,
      headers,
      signal: (controller.signal as unknown) as NonNullable<
        RequestInit["signal"]
      >
    });
    const encoding = response.headers.get("Content-Encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
      release();
      if (response.body instanceof Readable) {
        response.body.once("error", () => undefined);
      }
      controller.abort();
      if (response.body instanceof Readable) {
        response.body.destroy();
      }
      throw new Error(
        "Unsupported Content-Encoding in downstream response; expected identity"
      );
    }

    const body = response.body;
    if (callerSignal && body instanceof Readable) {
      releaseOnBodyCompletion(body, release);
    } else {
      release();
    }
    return response;
  } catch (error) {
    release();
    throw error;
  }
};

const uncompressedFetch = createUncompressedFetch();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const f = async (
  ...[a, b]: Parameters<typeof nodeFetch>
): ReturnType<typeof nodeFetch> => {
  // eslint-disable-next-line no-console
  console.log("--->", a, b);
  const r = await uncompressedFetch(a, b);
  // eslint-disable-next-line no-console
  console.log("+++++", r.status);
  return r;
};

export const createClient = (baseUrl: string, apiKey: string): SelfCareClient =>
  createClientBase({
    basePath: "",
    baseUrl,
    fetchApi: (f as unknown) as typeof fetch,
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    withDefaults: op => params =>
      op({
        ...params,
        apiKeyHeader: apiKey
      })
  });

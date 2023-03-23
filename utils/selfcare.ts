import nodeFetch from "node-fetch";
import {
  Client,
  createClient as createClientBase
} from "../generated/selfcare/client";

type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types
} & {};

export type SelfCareClient = Prettify<Client<"apiKeyHeader">>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const f = async (
  ...[a, b]: Parameters<typeof nodeFetch>
): ReturnType<typeof nodeFetch> => {
  // eslint-disable-next-line no-console
  console.log("--->", a, b);
  const r = await nodeFetch(a, b);
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

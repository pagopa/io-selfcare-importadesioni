import nodeFetch from "node-fetch";
import {
  createClient as createClientBase,
  Client
} from "../generated/selfcare/client";

type Prettify<T> = {
  [K in keyof T]: T[K];
  // eslint-disable-next-line @typescript-eslint/ban-types
} & {};

export type SelfCareClient = Prettify<Client<"apiKeyHeader">>;

export const createClient = (baseUrl: string, apiKey: string): SelfCareClient =>
  createClientBase({
    baseUrl,
    fetchApi: (nodeFetch as unknown) as typeof fetch,
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    withDefaults: op => params =>
      op({
        ...params,
        apiKeyHeader: apiKey
      })
  });

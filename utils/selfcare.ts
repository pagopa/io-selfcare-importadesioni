import nodeFetch from "node-fetch";
import {
  createClient as createClientBase,
  Client
} from "../generated/selfcare/client";

export type SelfCareClient = Client<"apiKeyHeader">;

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

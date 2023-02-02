/**
 * Use a singleton CosmosDB database across functions.
 */
import { CosmosClient } from "@azure/cosmos";
import { getConfigOrThrow } from "./config";

const config = getConfigOrThrow();
const cosmosDbUri = config.COSMOSDB_URI;
const masterKey = config.COSMOSDB_KEY;
const name = config.COSMOSDB_NAME;

export const cosmosdb = new CosmosClient({
  endpoint: cosmosDbUri,
  key: masterKey
}).database(name);

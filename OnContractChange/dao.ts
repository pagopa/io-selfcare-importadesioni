/**
 * DAO pattern to perform CRUD operations in the underlying persistence layer.
 */
import {
  Database,
  FeedOptions,
  FeedResponse,
  ItemDefinition,
  ItemResponse,
  PartitionKey,
  SqlQuerySpec
} from "@azure/cosmos";

const readItemById = (database: Database, containerId: string) => (
  itemId: string,
  partitionKeyValue?: PartitionKey
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<ItemResponse<any>> =>
  database
    .container(containerId)
    .item(itemId, partitionKeyValue)
    .read();

const readItemsByQuery = (database: Database, containerId: string) => (
  query: string | SqlQuerySpec,
  options?: FeedOptions | undefined
): Promise<FeedResponse<unknown>> =>
  database
    .container(containerId)
    .items.query<unknown>(query, options)
    .fetchAll();

const upsert = (database: Database, containerId: string) => <
  T extends ItemDefinition
>(
  item: T
): Promise<ItemResponse<ItemDefinition>> =>
  database.container(containerId).items.upsert<T>(item);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const dao = (database: Database) => (containerId: string) => ({
  readItemById: readItemById(database, containerId),
  readItemsByQuery: readItemsByQuery(database, containerId),
  upsert: upsert(database, containerId)
});

export type Dao = ReturnType<typeof dao>;

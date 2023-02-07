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
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";

// eslint-disable-next-line @typescript-eslint/naming-convention
interface ContractItem {
  readonly attachment: NonEmptyString;
  readonly delegates: unknown; // todo
  readonly id: NonEmptyString;
  readonly ipaCode: NonEmptyString;
  readonly version: NonEmptyString;
}
interface CollectionMap {
  readonly contracts: ContractItem;
}

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

const upsert = <C extends keyof CollectionMap>(
  database: Database,
  containerId: C
) => (item: CollectionMap[C]): Promise<ItemResponse<ItemDefinition>> =>
  database.container(containerId).items.upsert(item);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const dao = (database: Database) => <C extends keyof CollectionMap>(
  containerId: C
) => ({
  readItemById: readItemById(database, containerId),
  readItemsByQuery: readItemsByQuery(database, containerId),
  upsert: upsert(database, containerId)
});

export type Dao = ReturnType<typeof dao>;

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
import { IContract, IMembership } from "./types";

interface IContainerItemMap {
  readonly contracts: IContract;
  readonly memberships: IMembership;
  readonly pecDelegato: ItemDefinition;
  readonly pecAllegato: ItemDefinition;
  readonly pecEmail: ItemDefinition;
}

// eslint-disable-next-line functional/prefer-readonly-type
const flatten = <T>(arr: T[][]): T[] => arr.reduce((p, e) => [...p, ...e], []);

const readItemById = <T extends ItemDefinition>(
  database: Database,
  containerId: string
) => (
  itemId: string,
  partitionKeyValue: PartitionKey = itemId
): Promise<ItemResponse<T>> =>
  database
    .container(containerId)
    .item(itemId, partitionKeyValue)
    .read<T>();

// const existsItemById = (database: Database, containerId: string) => (
//   itemId: string,
//   partitionKeyValue?: PartitionKey
// ): Promise<boolean> =>
//   database
//     .container(containerId)
//     .item(itemId, partitionKeyValue)
//     .read()
//     .then(res => {
//       if (res.statusCode === 404) {
//         return false;
//       } else if (res.statusCode >= 200 && res.statusCode < 400) {
//         return true;
//       } else {
//         throw new Error(
//           `existsItemById for itemId = '${itemId}' and partitionKey = '${partitionKeyValue}' failed with status code = '${res.statusCode}'`
//         );
//       }
//     });

const readItemsByQuery = (database: Database, containerId: string) => (
  query: string | SqlQuerySpec,
  options?: FeedOptions | undefined
): Promise<FeedResponse<unknown>> =>
  database
    .container(containerId)
    .items.query<unknown>(query, options)
    .fetchAll();

const readAllItemsByQuery = (database: Database, containerId: string) => async (
  query: string | SqlQuerySpec,
  options?: FeedOptions | undefined
): Promise<FeedResponse<unknown>> => {
  const client = readItemsByQuery(database, containerId);
  // eslint-disable-next-line functional/no-let, functional/prefer-readonly-type
  const pages: unknown[][] = [];
  // eslint-disable-next-line functional/no-let
  let continuationToken: string | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await client(query, { ...options, continuationToken });
    // eslint-disable-next-line functional/immutable-data
    pages.push(response.resources);
    continuationToken = response.continuationToken;
    if (!response.hasMoreResults) {
      break;
    }
  }

  return new FeedResponse(flatten(pages), {}, false);
};

const upsert = <T extends ItemDefinition>(
  database: Database,
  containerId: string
) => (item: T): Promise<ItemResponse<ItemDefinition>> =>
  database.container(containerId).items.upsert<T>(item);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const dao = (database: Database) => <T extends keyof IContainerItemMap>(
  containerId: T
) => ({
  readAllItemsByQuery: readAllItemsByQuery(database, containerId),
  readItemById: readItemById(database, containerId),
  readItemsByQuery: readItemsByQuery(database, containerId),
  upsert: upsert<IContainerItemMap[T]>(database, containerId)
});

export type Dao = ReturnType<typeof dao>;

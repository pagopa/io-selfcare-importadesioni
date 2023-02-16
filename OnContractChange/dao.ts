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

export interface IMembership {
  readonly fiscalCode?: string;
  readonly id: string;
  readonly ipaCode: string;
  readonly mainInstitution: boolean;
  readonly status: string;
}

export interface IAttachment {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly kind: string;
}

export interface IContract {
  readonly attachment: IAttachment;
  readonly id: string;
  readonly ipaCode: string;
  readonly version: string;
}
interface IContainerItemMap {
  readonly contracts: IContract;
  readonly memberships: IMembership;
  readonly pecDelegato: ItemDefinition;
  readonly pecAllegato: ItemDefinition;
}

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

const upsert = <T extends ItemDefinition>(
  database: Database,
  containerId: string
) => (item: T): Promise<ItemResponse<ItemDefinition>> =>
  database.container(containerId).items.upsert<T>(item);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const dao = (database: Database) => <T extends keyof IContainerItemMap>(
  containerId: T
) => ({
  readItemById: readItemById(database, containerId),
  readItemsByQuery: readItemsByQuery(database, containerId),
  upsert: upsert<IContainerItemMap[T]>(database, containerId)
});

export type Dao = ReturnType<typeof dao>;

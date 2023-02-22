import { FeedResponse } from "@azure/cosmos";
import { Dao } from "../models/dao";

export const mockFeedResponse = <T>(resources: T[]) =>
  ({ resources } as FeedResponse<T>);

export const mockReadItemById = jest.fn();
export const mockReadAllItemsByQuery = jest.fn();
export const mockReadItemsByQuery = jest.fn();
export const mockUpsert = jest.fn();

export const dao = jest.fn<ReturnType<Dao>, [string]>(
  () =>
    (({
      readAllItemsByQuery: mockReadAllItemsByQuery,
      readItemById: mockReadItemById,
      readItemsByQuery: mockReadItemsByQuery,
      upsert: mockUpsert
    } as unknown) as ReturnType<Dao>)
);

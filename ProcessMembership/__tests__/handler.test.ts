import { FeedOptions, FeedResponse, ItemDefinition, ItemResponse, SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { Dao } from "../../OnContractChange/dao";
import { NotImplementedError, ValidationError } from "../../OnContractChange/error";
import createHandler from "../handler";

const mockReadItemById = jest.fn<Promise<ItemResponse<any>>, [itemId: string, partitionKeyValue?: unknown]>();

const mockReadItemsByQuery = jest.fn<Promise<FeedResponse<unknown>>, [query: string | SqlQuerySpec, options?: FeedOptions | undefined]>();

const mockUpsert = jest.fn<Promise<ItemResponse<ItemDefinition>>, [item: unknown]>();

const mockDao = jest.fn<ReturnType<Dao>, Parameters<Dao>>(_ => ({
  readItemById: mockReadItemById,
  readItemsByQuery: mockReadItemsByQuery,
  upsert: mockUpsert
}));

const mockContext = ({
  bindings: {
    log: console,
  }
} as unknown) as Context;


const aValidPayload = { ipaCode: "any string" };
describe("ProcessMembership", () => {
  it.each`
    scenario | payload
    ${"a serialized object"}    | ${JSON.stringify(aValidPayload)}
    ${"an object"}              | ${aValidPayload}
  `("should accept valid payload: $scenario", async ({ payload }) => {
    const handler = createHandler({dao: mockDao});

    // we expect the handler to fail as the implementation is not completed
    try {
       const _result = await handler(mockContext, payload) 
       fail()
    } catch (error) {
       expect(error).toEqual(expect.any(NotImplementedError))
    }
  });

  it.each`
    scenario | payload
    ${"a plain string"}              | ${"ipaCode"}
  `("should fail on invalid payloads: $scenario", async ({ payload }) => {
    const handler = createHandler({dao: mockDao});

    try {
       const _result = await handler(mockContext, payload) 
       fail()
    } catch (error) {
      expect(error).toEqual(expect.any(ValidationError))
    }
  });
});

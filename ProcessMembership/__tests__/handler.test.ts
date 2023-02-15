import { FeedOptions, FeedResponse, ItemDefinition, ItemResponse, SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { Dao } from "../../OnContractChange/dao";
import { NotImplementedError, ValidationError } from "../../OnContractChange/error";
import createHandler from "../handler";

const aContract = {
    CODICEIPA: "CODICEIPA",
    id: "id",
    IDALLEGATO: 1,
    TIPOCONTRATTO: "V1.0"
  };

const mockReadItemById = jest.fn<Promise<ItemResponse<any>>, [itemId: string, partitionKeyValue?: unknown]>();

const mockAllItemsByQuery = jest.fn(async () => [aContract]);
const mockReadItemsByQuery = jest.fn();

const mockUpsert = jest.fn();

const mockDao = jest.fn(_ => ({
  readAllItemsByQuery: mockAllItemsByQuery,
  readItemById: mockReadItemById,
  readItemsByQuery: mockReadItemsByQuery,
  upsert: mockUpsert
})) as unknown as Dao;

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

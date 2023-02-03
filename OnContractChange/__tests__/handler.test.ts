import { FeedOptions, FeedResponse, ItemDefinition, ItemResponse, SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { Dao } from "../dao";
import{ FetchMembershipError, FiscalCodeNotFoundError, UpsertError, ValidationError } from "../error";
import OnContractChangeHandler from "../handler";
import { IpaOpenData } from "../ipa";

const NO_BINDING_DATA = "placeholder for no data";
const mockContext = ({
  bindings: {
    log: console,
    ipaOpenData: NO_BINDING_DATA
  }
} as unknown) as Context;

const mockReadItemById = jest.fn<Promise<ItemResponse<any>>, [itemId: string, partitionKeyValue?: unknown]>(
  (_, __) => {
    throw new Error("mockReadItemById not initialized");
  }
);

const mockReadItemsByQuery = jest.fn<Promise<FeedResponse<unknown>>, [query: string | SqlQuerySpec, options?: FeedOptions | undefined]>(
  (_, __) => {
    throw new Error("mockReadItemsByQuery not initialized");
  }
);

const mockUpsert = jest.fn<Promise<ItemResponse<ItemDefinition>>, [item: unknown]>(_ => {
  throw new Error("mockUpsert not initialized");
});

const mockDao = jest.fn<ReturnType<Dao>, Parameters<Dao>>(_ => ({
  readItemById: mockReadItemById,
  readItemsByQuery: mockReadItemsByQuery,
  upsert: mockUpsert
}));

const mockReadIpaData = jest.fn<Promise<IpaOpenData>, [NodeJS.ReadableStream]>(_ => {
  throw new Error("mockReadIpaData not initialized");
});

beforeEach(() => {
  // jest.resetAllMocks();
  jest.clearAllMocks();
});

describe("OnContractChange", () => {
  const validDocument = {
    CODICEIPA: "CODICEIPA",
    ID: 1,
    IDALLEGATO: 1,
    IDEMAIL: 1,
    TIPOCONTRATTO: "V1.0"
  };
  it("should do nothing", async () => {
    const document = new Array();
    const result = await OnContractChangeHandler(mockDao, mockReadIpaData)(
      mockContext,
      document
    );
    expect(result).toHaveLength(0);
    expect(mockDao).toBeCalledTimes(0);
    expect(mockReadIpaData).toBeCalledTimes(0);
  });

  it("should fails document validation", async () => {
    const document = {...validDocument, TIPOCONTRATTO: "TIPOCONTRATTO"};
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
    }
    expect(mockDao).toBeCalledTimes(0);
    expect(mockReadIpaData).toBeCalledTimes(0);
  });


  it("should fails on fetching membership", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 500} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce(mockReadItemByIdResult);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(FetchMembershipError);
    }
    expect(mockDao).toBeCalledTimes(1);
    expect(mockDao).toBeCalledWith("memberships");
    expect(mockReadItemById).toBeCalledTimes(1);
    expect(mockReadItemById).toBeCalledWith(document.CODICEIPA, document.CODICEIPA);
    expect(mockReadItemsByQuery).toBeCalledTimes(0);
    expect(mockUpsert).toBeCalledTimes(0);
    expect(mockReadIpaData).toBeCalledTimes(0);
  });


   it("should fail fetch fiscal code from IPA", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 404} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce(mockReadItemByIdResult);
    mockReadIpaData.mockResolvedValueOnce(new Map([[document.CODICEIPA, undefined]]));
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(FiscalCodeNotFoundError);
    }
    expect(mockDao).toBeCalledTimes(1);
    expect(mockDao).toBeCalledWith("memberships");
    expect(mockReadItemById).toBeCalledTimes(1);
    expect(mockReadItemById).toBeCalledWith(document.CODICEIPA, document.CODICEIPA);
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockReadIpaData).toBeCalledWith(mockContext.bindings.ipaOpenData);
    expect(mockUpsert).toBeCalledTimes(0);
    expect(mockReadItemsByQuery).toBeCalledTimes(0);
  });

   it("should fail to save a not 'Main Institution'", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 404} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce(mockReadItemByIdResult);
    mockReadIpaData.mockResolvedValueOnce(new Map());
    const mockUpsertResult = {statusCode: 500} as ItemResponse<any>;
    mockUpsert.mockResolvedValueOnce(mockUpsertResult);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      console.log(error);
      expect(error).toBeInstanceOf(UpsertError);
    }
    expect(mockDao).toBeCalledTimes(2);
    expect(mockDao).toBeCalledWith("memberships");
    expect(mockReadItemById).toBeCalledTimes(1);
    expect(mockReadItemById).toBeCalledWith(document.CODICEIPA, document.CODICEIPA);
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockReadIpaData).toBeCalledWith(mockContext.bindings.ipaOpenData);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledWith({id: document.CODICEIPA,
      ipaCode: document.CODICEIPA,
      mainInstitution: false,
      status: "INITIAL"});
    expect(mockReadItemsByQuery).toBeCalledTimes(0);
  });

});

import { FeedOptions, FeedResponse, ItemDefinition, ItemResponse, SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { Dao, IAttachment } from "../dao";
import{ FetchMembershipError, FetchPecAttachmentError, FiscalCodeNotFoundError, SaveContractError, UpsertError, ValidationError } from "../error";
import OnContractChangeHandler from "../handler";

import * as TE from "fp-ts/lib/TaskEither";

const mockContext = ({
  log: {
    error: jest.fn().mockImplementation(console.log),
    info: jest.fn().mockImplementation(console.log),
    verbose: jest.fn().mockImplementation(console.log),
    warn: jest.fn().mockImplementation(console.log)
  }
} as unknown) as Context;

const mockReadItemById = jest.fn<Promise<ItemResponse<any>>, [itemId: string, partitionKeyValue?: unknown]>();

const mockReadItemsByQuery = jest.fn<Promise<FeedResponse<unknown>>, [query: string | SqlQuerySpec, options?: FeedOptions | undefined]>();

const mockUpsert = jest.fn<Promise<ItemResponse<ItemDefinition>>, [item: unknown]>();

const mockDao = jest.fn<ReturnType<Dao>, Parameters<Dao>>(_ => ({
  readItemById: mockReadItemById,
  readItemsByQuery: mockReadItemsByQuery,
  upsert: mockUpsert
}));


const mockIpaDefaultError = TE.left(new Error("mockReadIpaData not initialized"))
const mockIpaAnyData = TE.right(new Map())



beforeEach(() => {
  jest.resetAllMocks();
  mockReadItemById.mockRejectedValue(new Error("mockReadItemsByQuery not initialized"))
  mockReadItemsByQuery.mockRejectedValue(new Error("mockReadItemsByQuery not initialized"))
  mockUpsert.mockRejectedValue(new Error("mockUpsert not initialized"))
  mockDao.mockImplementation(_ => ({
    readItemById: mockReadItemById,
    readItemsByQuery: mockReadItemsByQuery,
    upsert: mockUpsert
  }));
});

afterEach(() => {
  expect(mockReadItemsByQuery).toBeCalledTimes(0);
});

describe("OnContractChange", () => {
  const validDocument = {
    CODICEIPA: "CODICEIPA",
    id: "id",
    IDALLEGATO: 1,
    TIPOCONTRATTO: "V1.0"
  };
  const validPecAttachment = {
    NOMEALLEGATO: "nome",
    PATHALLEGATO: "path",
    TIPOALLEGATO: "Contratto",
    id: "id",
    NOMEALLEGATONUOVO: undefined
  };
  const mapAttachment = (pecAttachment: typeof validPecAttachment): IAttachment => ({
    name: pecAttachment.NOMEALLEGATONUOVO ? pecAttachment.NOMEALLEGATONUOVO : pecAttachment.NOMEALLEGATO,
    path: pecAttachment.PATHALLEGATO,
    kind: pecAttachment.TIPOALLEGATO,
    id: pecAttachment.id
  });

  it("should do nothing", async () => {
    const document = new Array();
    const result = await OnContractChangeHandler(mockDao, mockIpaAnyData)(
      mockContext,
      document
    );
    expect(result).toHaveLength(0);
    expect(mockDao).toBeCalledTimes(0);
  });
  
  it.each`
    tipoContratto
    ${"Ins. Manuale"}
    ${null}
    ${undefined}
  `
  ("should skip item: tipoContratto = $tipoContratto", async ({tipoContratto}) => {
    const document = {...validDocument, TIPOCONTRATTO: tipoContratto};
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
    } catch (error) {
      fail();
    }
    expect(mockDao).toBeCalledTimes(0);
  });

  it("should fail document validation", async () => {
    const document = {...validDocument, CODICEIPA: undefined};
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
    }
    expect(mockDao).toBeCalledTimes(0);
  });

  it("should fails on fetching membership", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 500} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce(mockReadItemByIdResult);
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
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
    expect(mockReadItemById).toBeCalledWith(document.CODICEIPA.toLowerCase());
    expect(mockUpsert).toBeCalledTimes(0);
  });

   it("should fail fetch fiscal code from IPA", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 404} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce(mockReadItemByIdResult);
    // force to return an undefined fiscal code to test robustness
    const mockReadIpaData = TE.right(new Map([[document.CODICEIPA.toLowerCase(), undefined as any]]));
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
    expect(mockUpsert).toBeCalledTimes(0);
  });

   it("should fail to save a not 'Main Institution' membership", async () => {
    const document = {...validDocument};
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>);
    
    mockUpsert.mockResolvedValueOnce({statusCode: 500} as ItemResponse<any>);
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(UpsertError);
    }
    expect(mockDao).toBeCalledTimes(2);
    expect(mockDao).toBeCalledWith("memberships");
    expect(mockReadItemById).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledWith({id: document.CODICEIPA.toLowerCase(),
      fiscalCode: undefined, //mockIpaOpenData.get(document.CODICEIPA.toLowerCase()),
      ipaCode: document.CODICEIPA.toLowerCase(),
      mainInstitution: false,
      status: "INITIAL"});
  });

   it.each`
    fetchAttachmentStatusCode | fetchAttachmentResult                               | errorResultType             | causedBy
    ${404}                    | ${undefined}                                        | ${FetchPecAttachmentError}  | ${"Database error"}
    ${200}                    | ${({...validPecAttachment, TIPOALLEGATO: "Altro"})} | ${ValidationError}          | ${"result Validation error"}
   `
   ("should fail to fetch attachments caused by $causedBy", async ({ fetchAttachmentStatusCode, fetchAttachmentResult, errorResultType }) => {
    const document = {...validDocument};
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: fetchAttachmentStatusCode, resource: fetchAttachmentResult} as ItemResponse<any>);
    
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(errorResultType);
    }
    expect(mockDao).toBeCalledTimes(3);
    expect(mockDao).lastCalledWith("pecAllegato");
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockReadItemById).lastCalledWith(document.IDALLEGATO.toString());
    expect(mockUpsert).toBeCalledTimes(1);
  });

   it("should fail to save contract caused by Database error", async () => {
    const document = {...validDocument};
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment };
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
    
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 500} as ItemResponse<any>);
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(SaveContractError);
    }
    expect(mockDao).toBeCalledTimes(4);
    expect(mockDao).lastCalledWith("contracts");
    expect(mockReadItemById).toBeCalledTimes(2);
    
    expect(mockUpsert).toBeCalledTimes(2);
    expect(mockUpsert).lastCalledWith({
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      fiscalCode: undefined, //mockIpaOpenData.get(document.CODICEIPA.toLowerCase()),
      version: document.TIPOCONTRATTO, 
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });

   it.each`
    ipaOpenData                                             | institutionType
    ${new Map()}                                            | ${"not a 'Main Institution'"}
    ${new Map([[validDocument.CODICEIPA, "fiscal code"]])}  | ${"'Main Institution'"}
   `
   ("should complete without errors: $institutionType", async ({ ipaOpenData }) => {
    const document = {...validDocument};
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment, NOMEALLEGATONUOVO: "new name" } as any;
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
    
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    try {
      await OnContractChangeHandler(mockDao, TE.right(ipaOpenData))(
        mockContext,
        document
      );
    } catch (error) {
      fail();
    }
    expect(mockDao).toBeCalledTimes(4);
    expect(mockReadItemById).toBeCalledTimes(2);
  
    expect(mockUpsert).toBeCalledTimes(2);
    expect(mockUpsert).nthCalledWith(1, {id: document.CODICEIPA.toLowerCase(),
      fiscalCode: ipaOpenData.get(document.CODICEIPA.toLowerCase()),
      ipaCode: document.CODICEIPA.toLowerCase(),
      mainInstitution: ipaOpenData.has(document.CODICEIPA.toLowerCase()),
      status: "INITIAL"});
    expect(mockUpsert).nthCalledWith(2, {
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      version: document.TIPOCONTRATTO, 
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });
   
  it("should complete without errors for an already insert membership", async () => {
    const document = {...validDocument};
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment };
    mockReadItemById.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
    
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
    } catch (error) {
      fail();
    }
    expect(mockDao).toBeCalledTimes(3);
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockUpsert).lastCalledWith({
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      version: document.TIPOCONTRATTO, 
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });

});

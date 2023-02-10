import { FeedOptions, FeedResponse, ItemDefinition, ItemResponse, SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { Dao, IAttachment, IDelegate } from "../dao";
import{ FetchMembershipError, FetchPecAttachmentError, FetchPecDelegatesError, FiscalCodeNotFoundError, SaveContractError, UpsertError, ValidationError } from "../error";
import OnContractChangeHandler, { TipoContrattoEnum } from "../handler";
import { IpaOpenData } from "../ipa";

const NO_BINDING_DATA = "placeholder for no data";
const mockContext = ({
  bindings: {
    log: console,
    ipaOpenData: NO_BINDING_DATA
  },
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

const mockReadIpaData = jest.fn<Promise<IpaOpenData>, [NodeJS.ReadableStream]>();

beforeEach(() => {
  jest.resetAllMocks();
  mockReadItemById.mockRejectedValue(new Error("mockReadItemsByQuery not initialized"))
  mockReadItemsByQuery.mockRejectedValue(new Error("mockReadItemsByQuery not initialized"))
  mockUpsert.mockRejectedValue(new Error("mockUpsert not initialized"))
  mockReadIpaData.mockRejectedValue(new Error("mockReadIpaData not initialized"))
  mockDao.mockImplementation(_ => ({
    readItemById: mockReadItemById,
    readItemsByQuery: mockReadItemsByQuery,
    upsert: mockUpsert
  }));
});

describe("OnContractChange", () => {
  const validDocument = {
    CODICEIPA: "CODICEIPA",
    id: "id",
    IDALLEGATO: 1,
    TIPOCONTRATTO: "V1.0"
  };
  const validPecDelegate = {
    CODICEFISCALE: "CODICEFISCALE",
    EMAIL: "email@example.com",
    id: "id",
    IDALLEGATO: 1,
    NOMINATIVO: "Nome Cognome",
    QUALIFICA: undefined,
    TIPODELEGATO: "Principale"
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

const mapDelegate = (pecDelegate: typeof validPecDelegate): IDelegate => ({
  email: pecDelegate.EMAIL,
  firstName: pecDelegate.NOMINATIVO.split(" ", 1)[0],
  fiscalCode: pecDelegate.CODICEFISCALE,
  id: pecDelegate.id,
  attachmentId: pecDelegate.IDALLEGATO,
  kind: pecDelegate.TIPODELEGATO,
  lastName: pecDelegate.NOMINATIVO.split(" ").slice(1).join(" "),
  role: pecDelegate.QUALIFICA
}); 

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
    const document = {...validDocument, CODICEIPA: undefined};
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

  it.each`
    tipoContratto
    ${"Ins. Manuale"}
    ${null}
    ${undefined}
  `
  ("should skip item: tipoContratto = $tipoContratto", async ({tipoContratto}) => {
    const document = {...validDocument, TIPOCONTRATTO: tipoContratto};
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
    } catch (error) {
      console.log(error);
      fail();
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
    expect(mockReadItemById).toBeCalledWith(document.CODICEIPA.toLowerCase(), document.CODICEIPA.toLowerCase());
    expect(mockReadItemsByQuery).toBeCalledTimes(0);
    expect(mockUpsert).toBeCalledTimes(0);
    expect(mockReadIpaData).toBeCalledTimes(0);
  });

   it("should fail fetch fiscal code from IPA", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 404} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce(mockReadItemByIdResult);
    // force to return an undefined fiscal code to test robustness
    mockReadIpaData.mockResolvedValueOnce(new Map([[document.CODICEIPA.toLowerCase(), undefined as any]]));
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
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockReadIpaData).toBeCalledWith(mockContext.bindings.ipaOpenData);
    expect(mockUpsert).toBeCalledTimes(0);
    expect(mockReadItemsByQuery).toBeCalledTimes(0);
  });

   it("should fail to save a not 'Main Institution' membership", async () => {
    const document = {...validDocument};
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>);
    const mockIpaOpenData = new Map();
    mockReadIpaData.mockResolvedValueOnce(mockIpaOpenData);
    mockUpsert.mockResolvedValueOnce({statusCode: 500} as ItemResponse<any>);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
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
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledWith({id: document.CODICEIPA.toLowerCase(),
      fiscalCode: mockIpaOpenData.get(document.CODICEIPA.toLowerCase()),
      ipaCode: document.CODICEIPA.toLowerCase(),
      mainInstitution: false,
      status: "INITIAL"});
    expect(mockReadItemsByQuery).toBeCalledTimes(0);
  });

   it("should fail to fetch delegates caused by Database error", async () => {
    const document = {...validDocument};
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>);
    mockReadIpaData.mockResolvedValueOnce(new Map());
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    mockReadItemsByQuery.mockRejectedValueOnce({status: "500", reason: "error"});
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(FetchPecDelegatesError);
    }
    expect(mockDao).toBeCalledTimes(3);
    expect(mockDao).lastCalledWith("pecDelegato");
    expect(mockReadItemById).toBeCalledTimes(1);
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockReadItemsByQuery).toBeCalledTimes(1);
    expect(mockReadItemsByQuery).toBeCalledWith({
      parameters: [{ name: "@idAllegato", value: document.IDALLEGATO }],
      query: "SELECT * FROM pecDelegato d WHERE d.IDALLEGATO = *@idAllegato*"
    },
    { continuationToken: undefined });
  });

   it("should fail to fetch delegates caused by result validation error", async () => {
    const document = {...validDocument};
    let i = 0;
    const delegates = [
      {...validPecDelegate, id: validPecDelegate.id + ++i, TIPODELEGATO: "foo"}, 
      {...validPecDelegate, id: validPecDelegate.id + ++i, EMAIL: "email"}, 
      {...validPecDelegate, id: validPecDelegate.id + ++i, CODICEFISCALE: undefined}
    ];
    const mockReadItemsByQueryResults = [
      {hasMoreResults: true, continuationToken: "continuationToken", resources: delegates.slice(0, 2)},
      {hasMoreResults: false, resources: delegates.slice(2)}
    ] as FeedResponse<unknown>[];
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>);
    mockReadIpaData.mockResolvedValueOnce(new Map());
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    mockReadItemsByQuery.mockResolvedValueOnce(mockReadItemsByQueryResults[0])
                        .mockResolvedValueOnce(mockReadItemsByQueryResults[1]);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
    }
    expect(mockDao).toBeCalledTimes(4);
    expect(mockDao).lastCalledWith("pecDelegato");
    expect(mockReadItemById).toBeCalledTimes(1);
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockReadItemsByQuery).toBeCalledTimes(2);
     const sqlQuerySpec = {
       parameters: [{ name: "@idAllegato", value: document.IDALLEGATO }],
       query: "SELECT * FROM pecDelegato d WHERE d.IDALLEGATO = *@idAllegato*"
     };
    expect(mockReadItemsByQuery).nthCalledWith(1, sqlQuerySpec,
    { continuationToken: undefined });
    expect(mockReadItemsByQuery).nthCalledWith(2, sqlQuerySpec,
    { continuationToken: mockReadItemsByQueryResults[0].continuationToken });
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
    mockReadIpaData.mockResolvedValueOnce(new Map());
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    mockReadItemsByQuery.mockResolvedValueOnce({hasMoreResults: false, resources: [{...validPecDelegate}]} as FeedResponse<unknown>);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(errorResultType);
    }
    expect(mockDao).toBeCalledTimes(4);
    expect(mockDao).lastCalledWith("pecAllegato");
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockReadItemById).lastCalledWith(document.IDALLEGATO.toString(), document.IDALLEGATO);
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockReadItemsByQuery).toBeCalledTimes(1);
  });

   it("should fail to save contract caused by Database error", async () => {
    const document = {...validDocument};
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment };
    const mockReadPecDelegatesByQueryResult = [{ ...validPecDelegate }];
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
     const mockIpaOpenData = new Map();
    mockReadIpaData.mockResolvedValueOnce(mockIpaOpenData);
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 500} as ItemResponse<any>);
    mockReadItemsByQuery.mockResolvedValueOnce({hasMoreResults: false, resources: mockReadPecDelegatesByQueryResult} as FeedResponse<unknown>);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(SaveContractError);
    }
    expect(mockDao).toBeCalledTimes(5);
    expect(mockDao).lastCalledWith("contracts");
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockReadIpaData).toBeCalledTimes(1);
    expect(mockUpsert).toBeCalledTimes(2);
    expect(mockReadItemsByQuery).toBeCalledTimes(1);
    expect(mockUpsert).lastCalledWith({
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      fiscalCode: mockIpaOpenData.get(document.CODICEIPA.toLowerCase()),
      version: document.TIPOCONTRATTO, 
      delegates: mockReadPecDelegatesByQueryResult.map(mapDelegate), 
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
    const mockReadPecDelegatesByQueryResult = [{ ...validPecDelegate }];
    mockReadItemById.mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
    mockReadIpaData.mockResolvedValueOnce(ipaOpenData);
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    mockReadItemsByQuery.mockResolvedValueOnce({hasMoreResults: false, resources: mockReadPecDelegatesByQueryResult} as FeedResponse<unknown>);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
    } catch (error) {
      fail();
    }
    expect(mockDao).toBeCalledTimes(5);
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockReadIpaData).toBeCalledTimes(1);
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
      delegates: mockReadPecDelegatesByQueryResult.map(mapDelegate), 
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
    expect(mockReadItemsByQuery).toBeCalledTimes(1);
  });
   
  it("should complete without errors for an already insert membership", async () => {
    const document = {...validDocument};
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment };
    const mockReadPecDelegatesByQueryResult = [{ ...validPecDelegate }];
    mockReadItemById.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
    mockReadIpaData.mockResolvedValueOnce(new Map());
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    mockReadItemsByQuery.mockResolvedValueOnce({hasMoreResults: false, resources: mockReadPecDelegatesByQueryResult} as FeedResponse<unknown>);
    try {
      await OnContractChangeHandler(mockDao, mockReadIpaData)(
        mockContext,
        document
      );
    } catch (error) {
      fail();
    }
    expect(mockDao).toBeCalledTimes(4);
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockReadIpaData).toBeCalledTimes(0);
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockReadItemsByQuery).toBeCalledTimes(1);
    expect(mockUpsert).lastCalledWith({
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      version: document.TIPOCONTRATTO, 
      delegates: mockReadPecDelegatesByQueryResult.map(mapDelegate), 
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });

});

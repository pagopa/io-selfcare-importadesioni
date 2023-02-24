import { FeedOptions, FeedResponse, ItemDefinition, ItemResponse, SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { Dao } from "../../models/dao";
import{ FetchMembershipError, FetchPecAttachmentError, FetchPecEmailError, FiscalCodeNotFoundError, SaveContractError, UpsertError, ValidationError } from "../../models/error";
import OnContractChangeHandler from "../handler";

import * as TE from "fp-ts/lib/TaskEither";
import { IIpaOpenData } from "../ipa";
import { pipe } from "fp-ts/lib/function";
import { key } from "monocle-ts/lib/Lens";

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
  readAllItemsByQuery: jest.fn(),
  readItemById: mockReadItemById,
  readItemsByQuery: mockReadItemsByQuery,
  upsert: mockUpsert
}));


const mockIpaDefaultError = TE.left(new Error("mockReadIpaData not initialized"))
const mockIpaAnyData = TE.right({
  getFiscalCode: (_) => undefined,
  getIpaCode: (_) => undefined,
  hasIpaCode: (_) => false,
  hasFiscalCode: (_) => false
} as IIpaOpenData)



beforeEach(() => {
  jest.resetAllMocks();
  mockReadItemById.mockRejectedValue(new Error("mockReadItemsByQuery not initialized"))
  mockReadItemsByQuery.mockRejectedValue(new Error("mockReadItemsByQuery not initialized"))
  mockUpsert.mockRejectedValue(new Error("mockUpsert not initialized"))
  mockDao.mockImplementation(_ => ({
    readAllItemsByQuery: jest.fn() /* not used here */,
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
    CODICEFISCALE: "CODICEFISCALE",
    CODICEIPA: "CODICEIPA",
    id: "id",
    IDALLEGATO: 1,
    IDEMAIL: 2,
    TIPOCONTRATTO: "V1.0"
  };
  const validPecEmail = {
    DATAEMAIL: "2021-12-06T17:33:40.000000000+00:00",
    COMUNECODICEFISCALE: "COMUNECODICEFISCALE",
    COMUNECODICEIPA: "COMUNECODICEIPA"
  };
  const validPecAttachment = {
    NOMEALLEGATO: "nome",
    PATHALLEGATO: "path",
    TIPOALLEGATO: "Contratto",
    id: "id",
    NOMEALLEGATONUOVO: undefined
  };
  const mapAttachment = (pecAttachment: typeof validPecAttachment) => ({
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

  it.each`
  fetchStatusCode | fetchResult                                          | errorResultType        | causedBy
   ${404}         | ${undefined}                                         | ${FetchPecEmailError}  | ${"Database error"}
   ${200}         | ${({...validPecEmail, DATAEMAIL: undefined})}        | ${ValidationError}     | ${"result Validation error"}
  `
  ("should fail to fetch email caused by $causedBy", async ({ fetchStatusCode, fetchResult, errorResultType }) => {
   const document = {...validDocument};
   mockReadItemById.mockResolvedValueOnce({statusCode: fetchStatusCode, resource: fetchResult} as ItemResponse<any>);
   try {
     await OnContractChangeHandler(mockDao, mockIpaAnyData)(
       mockContext,
       document
     );
     fail();
   } catch (error) {
     expect(error).toBeInstanceOf(errorResultType);
   }
   expect(mockDao).toBeCalledTimes(1);
   expect(mockDao).lastCalledWith("pecEmail");
   expect(mockReadItemById).toBeCalledTimes(1);
   expect(mockReadItemById).lastCalledWith(document.IDEMAIL.toString());
   expect(mockUpsert).toBeCalledTimes(0);
 });

 it("should fail fetch fiscal code from IPA", async () => {
  const document = {...validDocument};
  const mockReadItemByIdResult = {statusCode: 404} as ItemResponse<any>;
  mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: { ...validPecEmail }} as ItemResponse<any>)
                  .mockResolvedValueOnce(mockReadItemByIdResult);
  // force to return an undefined fiscal code to test robustness
  const mockIpaCode2FiscalCode = new Map([[document.CODICEIPA.toLowerCase(), undefined as any]]);
  const mockReadIpaData = pipe(
    mockIpaAnyData,
    TE.map(mockIpaAnyData => ({
      ...mockIpaAnyData,
      getFiscalCode: mockIpaCode2FiscalCode.get.bind(mockIpaCode2FiscalCode),
      hasIpaCode: mockIpaCode2FiscalCode.has.bind(mockIpaCode2FiscalCode)
    }))
  );
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
  expect(mockReadItemById).toBeCalledTimes(1);
  expect(mockUpsert).toBeCalledTimes(0);
});

  it("should fails on fetching membership", async () => {
    const document = {...validDocument};
    const mockReadItemByIdResult = {statusCode: 500} as ItemResponse<any>;
    mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: { ...validPecEmail }} as ItemResponse<any>)
                    .mockResolvedValueOnce(mockReadItemByIdResult);
    try {
      await OnContractChangeHandler(mockDao, mockIpaAnyData)(
        mockContext,
        document
      );
      fail();
    } catch (error) {
      expect(error).toBeInstanceOf(FetchMembershipError);
    }
    expect(mockDao).toBeCalledTimes(2);
    expect(mockDao).toBeCalledWith("memberships");
    expect(mockReadItemById).toBeCalledTimes(2);
    expect(mockReadItemById).toBeCalledWith(document.CODICEIPA.toLowerCase());
    expect(mockUpsert).toBeCalledTimes(0);
  });

  it("should fail to save a not 'Main Institution' membership", async () => {
  const document = {...validDocument};
  mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: { ...validPecEmail }} as ItemResponse<any>)
                  .mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>);
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
  expect(mockDao).toBeCalledTimes(3);
  expect(mockReadItemById).toBeCalledTimes(2);
  expect(mockUpsert).toBeCalledTimes(1);
  expect(mockUpsert).toBeCalledWith({id: document.CODICEIPA.toLowerCase(),
    fiscalCode: undefined, //mockIpaOpenData.get(document.CODICEIPA.toLowerCase()),
    ipaCode: document.CODICEIPA.toLowerCase(),
    mainInstitution: false,
    status: "Initial"});
});

   it.each`
    fetchAttachmentStatusCode | fetchAttachmentResult                               | errorResultType             | causedBy
    ${404}                    | ${undefined}                                        | ${FetchPecAttachmentError}  | ${"Database error"}
    ${200}                    | ${({...validPecAttachment, TIPOALLEGATO: "Altro"})} | ${ValidationError}          | ${"result Validation error"}
   `
   ("should fail to fetch attachments caused by $causedBy", async ({ fetchAttachmentStatusCode, fetchAttachmentResult, errorResultType }) => {
    const document = {...validDocument};
    mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: { ...validPecEmail }} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
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
    expect(mockDao).toBeCalledTimes(4);
    expect(mockDao).lastCalledWith("pecAllegato");
    expect(mockReadItemById).toBeCalledTimes(3);
    expect(mockReadItemById).lastCalledWith(document.IDALLEGATO.toString());
    expect(mockUpsert).toBeCalledTimes(1);
  });

   it("should fail to save contract caused by Database error", async () => {
    const document = {...validDocument};
    const mockReadPecEmailByIdResult = { ...validPecEmail };
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment };
    mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: mockReadPecEmailByIdResult} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
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
    expect(mockDao).toBeCalledTimes(5);
    expect(mockDao).lastCalledWith("contracts");
    expect(mockReadItemById).toBeCalledTimes(3);
    
    expect(mockUpsert).toBeCalledTimes(2);
    expect(mockUpsert).lastCalledWith({
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      fiscalCode: undefined, //mockIpaOpenData.get(document.CODICEIPA.toLowerCase()),
      version: document.TIPOCONTRATTO,
      emailDate: mockReadPecEmailByIdResult.DATAEMAIL,
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });

   it.each`
    codiceIpa        | comuneCodiceIpa      | codiceFiscale      | comuneCodiceFiscale       | ipaCode2FiscalCode                       | fiscalCode2ipaCode                               | expectedIpaCode       | expectedFiscalCode  | expectedMainInstitution | testCase
    ${"CODICEIPA"}   | ${"COMUNECODICEIPA"} | ${null}            | ${null}                   | ${new Map()}                             | ${new Map()}                                     | ${"codiceipa"}        | ${undefined}        | ${false}                | ${"not a 'Main Institution'"}
    ${"CODICEIPA"}   | ${"COMUNECODICEIPA"} | ${null}            | ${null}                   | ${new Map([["codiceipa", "CF"]])}        | ${new Map()}                                     | ${"codiceipa"}        | ${"CF"}             | ${true}                 | ${"'Main Institution' IPA code from 'CODICEIPA'"}
    ${"CODICEIPA"}   | ${"COMUNECODICEIPA"} | ${null}            | ${null}                   | ${new Map([["comunecodiceipa", "CF"]])}  | ${new Map()}                                     | ${"comunecodiceipa"}  | ${"CF"}             | ${true}                 | ${"'Main Institution' IPA code from 'COMUNECODICEIPA'"}
    ${"CODICEIPA"}   | ${"COMUNECODICEIPA"} | ${"CODICEFISCALE"} | ${null}                   | ${new Map([["ipaCode", "CF"]])}          | ${new Map([["codicefiscale", "ipaCode"]])}       | ${"ipaCode"}          | ${"CF"}             | ${true}                 | ${"'Main Institution' IPA code from 'CODICEIPA' (MLC)"}
    ${"CODICEIPA"}   | ${"COMUNECODICEIPA"} | ${"CODICEFISCALE"} | ${"COMUNECODICEFISCALE"}  | ${new Map([["ipaCode", "CF"]])}          | ${new Map([["comunecodicefiscale", "ipaCode"]])} | ${"ipaCode"}          | ${"CF"}             | ${true}                 | ${"'Main Institution' IPA code from 'COMUNECODICEIPA' (MLC)"}
    ${"CODICE-IPA"}  | ${"COMUNECODICEIPA"} | ${"CODICEFISCALE"} | ${"COMUNECODICEFISCALE"}  | ${new Map([["codice_ipa", "CF"]])}       | ${new Map()}                                     | ${"codice_ipa"}       | ${"CF"}             | ${true}                 | ${"'Main Institution' IPA code from 'COMUNECODICEIPA' (MLC)"}
   `
   ("should complete without errors: $testCase", async ({ codiceIpa, comuneCodiceIpa, ipaCode2FiscalCode, fiscalCode2ipaCode, expectedIpaCode, expectedFiscalCode, expectedMainInstitution }) => {
    const document = {...validDocument, CODICEIPA: codiceIpa};
    const mockReadPecEmailByIdResult = { ...validPecEmail, COMUNECODICEIPA: comuneCodiceIpa };
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment, NOMEALLEGATONUOVO: "new name" } as any;
    mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: mockReadPecEmailByIdResult} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 404} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200, resource: mockReadPecAttachmentByIdResult} as ItemResponse<any>);
    mockUpsert.mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
              .mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>);
    const mockIpaData = TE.right({
      getFiscalCode: ipaCode2FiscalCode.get.bind(ipaCode2FiscalCode),
      hasIpaCode: ipaCode2FiscalCode.has.bind(ipaCode2FiscalCode),
      hasFiscalCode: fiscalCode2ipaCode.has.bind(fiscalCode2ipaCode),
      getIpaCode: fiscalCode2ipaCode.get.bind(fiscalCode2ipaCode)
    });
    try {
      await OnContractChangeHandler(mockDao, mockIpaData)(
        mockContext,
        document
      );
    } catch (error) {
      fail();
    }
    expect(mockDao).toBeCalledTimes(5);
    expect(mockReadItemById).toBeCalledTimes(3);
    expect(mockUpsert).toBeCalledTimes(2);
    expect(mockUpsert).nthCalledWith(1, {id: expectedIpaCode,
      fiscalCode: expectedFiscalCode,
      ipaCode: expectedIpaCode,
      mainInstitution: expectedMainInstitution,
      status: "Initial"});
    expect(mockUpsert).nthCalledWith(2, {
      id: document.id, 
      ipaCode: expectedIpaCode, 
      version: document.TIPOCONTRATTO,
      emailDate: mockReadPecEmailByIdResult.DATAEMAIL,
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });
   
  it("should complete without errors for an already insert membership", async () => {
    const document = {...validDocument};
    const mockReadPecEmailByIdResult = { ...validPecEmail };
    const mockReadPecAttachmentByIdResult = { ...validPecAttachment };
    mockReadItemById.mockResolvedValueOnce({statusCode: 200, resource: mockReadPecEmailByIdResult} as ItemResponse<any>)
                    .mockResolvedValueOnce({statusCode: 200} as ItemResponse<any>)
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
    expect(mockDao).toBeCalledTimes(4);
    expect(mockReadItemById).toBeCalledTimes(3);
    expect(mockReadItemById).nthCalledWith(2, document.CODICEIPA.toLowerCase());
    expect(mockUpsert).toBeCalledTimes(1);
    expect(mockUpsert).lastCalledWith({
      id: document.id, 
      ipaCode: document.CODICEIPA.toLowerCase(), 
      version: document.TIPOCONTRATTO,
      emailDate: mockReadPecEmailByIdResult.DATAEMAIL,
      attachment: mapAttachment(mockReadPecAttachmentByIdResult)
    });
  });

});

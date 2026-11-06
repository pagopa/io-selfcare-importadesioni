import { Context } from "@azure/functions";
import {
  dao,
  mockFeedResponse,
  mockReadAllItemsByQuery,
  mockReadItemById,
  mockUpsert
} from "../../__mocks__/dao";
import { ValidationError } from "../../models/error";
import createHandler from "../handler";
import { ContractVersion, IAttachment, IContract } from "../../models/types";
import { selfcareClient } from "../../__mocks__/selfcare";
import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";

import { NumberFromString } from "io-ts-types/lib/NumberFromString";
import { withDefault } from "@pagopa/ts-commons/lib/types";

const mockContext = ({
  log: {
    error: jest.fn(),
    info: jest.fn()
  },
  bindings: {
    log: console
  }
} as unknown) as Context;

const aValidPayload = { ipaCode: "ente_test", fiscalCode: "00000000000" };

const anAttachment = pipe(
  {
    kind: "Contratto",
    id: "string",
    name: "contratto-test.p7m",
    path: "contratti-test/contratto-test.p7m"
  },
  IAttachment.decode,
  E.mapLeft(readableReport),
  E.getOrElseW(err => {
    throw err;
  })
);
const aContractVersion: ContractVersion = "V2.2(29 luglio)";
const _aContract: IContract = pipe(
  {
    attachment: anAttachment,
    emailDate: "2021-12-06T17:33:40.000Z",
    id: "string",
    ipaCode: aValidPayload.ipaCode,
    isAggregator: false,
    version: aContractVersion
  },
  IContract.decode,
  E.mapLeft(readableReport),
  E.getOrElseW(err => {
    throw err;
  })
);

beforeEach(() => {
  jest.resetAllMocks();
});

describe("ProcessMembership", () => {
  it.each`
    scenario            | payload
    ${"a plain string"} | ${"ipaCode"}
  `("should fail on invalid payloads: $scenario", async ({ payload }) => {
    const handler = createHandler({ dao, selfcareClient });

    try {
      const _result = await handler(mockContext, payload);
      fail();
    } catch (error) {
      expect(error).toEqual(expect.any(ValidationError));
    }
  });

  describe("local import with fake data", () => {
    const membership = {
      ...aValidPayload,
      id: aValidPayload.ipaCode,
      mainInstitution: true,
      status: "Initial"
    };
    const delegate = {
      CODICEFISCALE: " rssmra80a01h501u ",
      EMAIL: " mario.rossi@example.com ",
      IDALLEGATO: _aContract.attachment.id,
      NOMINATIVO: "Mario Rossi",
      TIPODELEGATO: "Principale",
      id: "delegato-test"
    };
    const mockSubmitClaim = selfcareClient.contractOnboardingUsingPOST as jest.Mock;

    beforeEach(() => {
      dao.mockImplementation(() => ({
        readAllItemsByQuery: mockReadAllItemsByQuery,
        readItemsByQuery: jest.fn(),
        readItemById: mockReadItemById,
        upsert: mockUpsert
      }));
      mockReadAllItemsByQuery.mockImplementation(containerQuery =>
        Promise.resolve(
          mockFeedResponse<unknown>(
            containerQuery.query.includes("FROM contracts")
              ? [_aContract]
              : [delegate]
          )
        )
      );
      mockReadItemById.mockResolvedValue({ resource: membership });
      mockUpsert.mockResolvedValue({ statusCode: 200 });
    });

    it.each([201, 409])(
      "should import a fake membership when SelfCare responds %s",
      async status => {
        mockSubmitClaim.mockResolvedValue(E.right({ status }));
        const handler = createHandler({ dao, selfcareClient });

        await handler(mockContext, JSON.stringify(aValidPayload));

        expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
        expect(mockSubmitClaim).toHaveBeenCalledWith({
          externalInstitutionId: aValidPayload.fiscalCode,
          body: {
            importContract: {
              contractType: aContractVersion,
              fileName: _aContract.attachment.name,
              filePath: _aContract.attachment.path,
              onboardingDate: new Date(_aContract.emailDate)
            },
            users: [
              {
                email: "mario.rossi@example.com",
                name: "Mario",
                surname: "Rossi",
                role: "MANAGER",
                taxCode: "RSSMRA80A01H501U"
              }
            ]
          }
        });
        expect(mockUpsert).toHaveBeenCalledWith({
          ...membership,
          status: "Processed",
          note: expect.stringContaining(
            status === 409
              ? "Successful imported (already onboarded)"
              : "Successful imported"
          )
        });
      }
    );

    it.each(["network", "response"])(
      "should mark the membership as failed on a SelfCare %s error",
      async failure => {
        if (failure === "network") {
          mockSubmitClaim.mockRejectedValue(new Error("Simulated offline service"));
        } else {
          mockSubmitClaim.mockResolvedValue(
            E.right({ status: 500, value: { detail: "Simulated server error" } })
          );
        }
        const handler = createHandler({ dao, selfcareClient });

        await expect(handler(mockContext, aValidPayload)).resolves.toBeUndefined();

        expect(mockSubmitClaim).toHaveBeenCalledTimes(1);
        expect(mockUpsert).toHaveBeenCalledWith({
          ...membership,
          status: "Failed",
          note: expect.stringContaining(
            failure === "network" ? "Failed to connect" : "Selfcare responded 500"
          )
        });
      }
    );

    it("should discard the membership without calling SelfCare when no manager exists", async () => {
      mockReadAllItemsByQuery
        .mockResolvedValueOnce(mockFeedResponse([_aContract]))
        .mockResolvedValueOnce(mockFeedResponse([]));
      const handler = createHandler({ dao, selfcareClient });

      await handler(mockContext, aValidPayload);

      expect(mockSubmitClaim).not.toHaveBeenCalled();
      expect(mockUpsert).toHaveBeenCalledWith({
        ...membership,
        status: "Discarded",
        note: expect.stringContaining("No manager found")
      });
    });
  });
});

it("dsdsds", () => {
  pipe(
    undefined,
    withDefault(NumberFromString, "100" as any).decode,
    E.mapLeft(readableReport),
    console.log
  );
});

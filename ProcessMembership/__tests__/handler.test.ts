import {
  FeedOptions,
  FeedResponse,
  ItemDefinition,
  ItemResponse,
  SqlQuerySpec
} from "@azure/cosmos";
import { Context } from "@azure/functions";
import {
  dao,
  mockFeedResponse,
  mockReadAllItemsByQuery,
  mockUpsert
} from "../../__mocks__/dao";
import { NotImplementedError, ValidationError } from "../../models/error";
import createHandler from "../handler";
import {
  ContractVersion,
  IAttachment,
  IContract,
  PecDelegate
} from "../../models/types";
import * as E from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";

const mockContext = ({
  bindings: {
    log: console
  }
} as unknown) as Context;

const aValidPayload = { ipaCode: "any string" };

const anAttachment = pipe(
  {
    kind: "Contratto",
    id: "string",
    name: "string",
    path: "string"
  },
  IAttachment.decode,
  E.mapLeft(readableReport),
  E.getOrElseW(err => {
    throw err;
  })
);
const aContractVersion: ContractVersion = "V2.2(29 luglio)";
const aContract: IContract = pipe(
  {
    attachment: anAttachment,
    emailDate: "string",
    id: "string",
    ipaCode: "string",
    version: aContractVersion
  },
  IContract.decode,
  E.mapLeft(readableReport),
  E.getOrElseW(err => {
    throw err;
  })
);

const aDelegate = pipe(
  {
    CODICEFISCALE: "AAAAAA00A00A000A",
    EMAIL: "email@example.com",
    IDALLEGATO: 20,
    NOMINATIVO: "mario rossi",
    TIPODELEGATO: "Altro",
    id: "string"
  },
  PecDelegate.decode,
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
    const handler = createHandler({ dao });

    try {
      const _result = await handler(mockContext, payload);
      fail();
    } catch (error) {
      expect(error).toEqual(expect.any(ValidationError));
    }
  });
});

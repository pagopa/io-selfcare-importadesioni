import { NonNegativeNumber } from "@pagopa/ts-commons/lib/numbers";
import {
  EmailString,
  FiscalCode,
  NonEmptyString
} from "@pagopa/ts-commons/lib/strings";
import * as t from "io-ts";

export type IpaCode = t.TypeOf<typeof IpaCode>;
export const IpaCode = t.string;

export type MembershipStatus = t.TypeOf<typeof MembershipStatus>;
export const MembershipStatus = t.union([
  t.literal("Initial"),
  t.literal("Processed"),
  t.literal("Discarded")
]);

const Institution = t.union([
  t.type({
    fiscalCode: NonEmptyString,
    ipaCode: IpaCode,
    mainInstitution: t.literal(true)
  }),
  t.intersection([
    t.type({ ipaCode: IpaCode, mainInstitution: t.literal(false) }),
    t.partial({ fiscalCode: NonEmptyString })
  ])
]);

export type IMembership = t.TypeOf<typeof IMembership>;
export const IMembership = t.intersection([
  Institution,
  t.type({
    id: t.string, // same value as ipaCode
    status: t.string
  }),
  t.partial({ note: t.string })
]);

export type IAttachment = t.TypeOf<typeof IAttachment>;
export const IAttachment = t.type({
  id: t.string,
  kind: t.string,
  name: t.string,
  path: t.string
});

export type IContract = t.TypeOf<typeof IContract>;
export const IContract = t.type({
  attachment: IAttachment,
  emailDate: t.string,
  id: t.string,
  ipaCode: IpaCode,
  version: t.string
});

export type TipoDelegato = t.TypeOf<typeof TipoDelegato>;
export const TipoDelegato = t.union([
  t.literal("Principale"),
  t.literal("Secondario"),
  t.literal("Altro")
]);

export type PecDelegate = t.TypeOf<typeof PecDelegate>;
export const PecDelegate = t.interface({
  CODICEFISCALE: FiscalCode,
  EMAIL: EmailString,
  IDALLEGATO: NonNegativeNumber,
  NOMINATIVO: t.union([NonEmptyString, t.null]),
  TIPODELEGATO: TipoDelegato,
  id: NonEmptyString
});

export type IContractWithDelegates = t.TypeOf<typeof IContractWithDelegates>;
export const IContractWithDelegates = t.intersection([
  IContract,
  t.type({
    delegates: t.readonlyArray(PecDelegate)
  })
]);

export type TipoContratto = t.TypeOf<typeof TipoContratto>;
export const TipoContratto = t.union([
  t.literal("V1.0"),
  t.literal("V2.0"),
  t.literal("V2.2(17 giugno)"),
  t.literal("V2.2(29 luglio)")
]);

import {
  EmailString,
  FiscalCode,
  NonEmptyString
} from "@pagopa/ts-commons/lib/strings";
import * as t from "io-ts";

export type IpaCode = t.TypeOf<typeof IpaCode>;
export const IpaCode = NonEmptyString;

// The status we consider when processing a Membership
export type MembershipStatus = t.TypeOf<typeof MembershipStatus>;
export const MembershipStatus = t.union([
  t.literal("Initial"),
  t.literal("Processed"),
  t.literal("Discarded"),
  t.literal("Failed")
]);

// The unique version of contract
export type ContractVersion = t.TypeOf<typeof ContractVersion>;
export const ContractVersion = t.union([
  t.null,
  t.literal("Ins. Manuale"),
  t.literal("V0.x"),
  t.literal("V1.0"),
  t.literal("V1.1"),
  t.literal("V2.0"),
  t.literal("V2.1"),
  t.literal("V2.2(17 giugno)"),
  t.literal("V2.2(29 luglio)"),
  t.literal("V2.3")
]);

export type TipoDelegato = t.TypeOf<typeof TipoDelegato>;
export const TipoDelegato = t.union([
  t.literal("Principale"),
  t.literal("Secondario"),
  t.literal("Altro")
]);

// An institution as is processed by our importer
// and processed
export type IMembership = t.TypeOf<typeof IMembership>;
export const IMembership = t.intersection([
  t.type({
    id: NonEmptyString, // same value as ipaCode
    ipaCode: IpaCode,
    mainInstitution: t.boolean,
    status: MembershipStatus
  }),
  t.partial({ fiscalCode: NonEmptyString, note: t.string })
]);

// An attacpment as is processed by our importer
export type IAttachment = t.TypeOf<typeof IAttachment>;
export const IAttachment = t.type({
  id: NonEmptyString,
  kind: t.union([t.literal("Contratto"), t.literal("Altro")]),
  name: NonEmptyString,
  path: NonEmptyString
});

// A contract as is processed by our importer
export type IContract = t.TypeOf<typeof IContract>;
export const IContract = t.type({
  attachment: IAttachment,
  emailDate: NonEmptyString,
  id: NonEmptyString,
  ipaCode: IpaCode,
  isAggregator: t.boolean,
  version: ContractVersion
});

// Delegate as we read from source data
export type PecDelegate = t.TypeOf<typeof PecDelegate>;
export const PecDelegate = t.interface({
  CODICEFISCALE: FiscalCode,
  EMAIL: EmailString,
  IDALLEGATO: NonEmptyString,
  NOMINATIVO: t.union([NonEmptyString, t.null]),
  TIPODELEGATO: TipoDelegato,
  id: NonEmptyString
});

export type ValidContractVersion = t.TypeOf<typeof ValidContractVersion>;
// match all but "0.x"
// const ValidContractVersion = PatternString("^(?!(V0.x)$).*$");
export const ValidContractVersion = t.union([
  t.literal("V1.0"),
  t.literal("V1.1"),
  t.literal("V2.0"),
  t.literal("V2.1"),
  t.literal("V2.2(17 giugno)"),
  t.literal("V2.2(29 luglio)"),
  t.literal("V2.3")
]);

export type ValidContract = t.TypeOf<typeof ValidContract>;
export const ValidContract = t.intersection([
  IContract,
  t.type({
    version: ValidContractVersion
  })
]);

// Enrich contract with relative delegates
export type IContractWithDelegates = t.TypeOf<typeof IContractWithDelegates>;
export const IContractWithDelegates = t.intersection([
  ValidContract,
  t.type({
    delegates: t.readonlyArray(PecDelegate)
  })
]);

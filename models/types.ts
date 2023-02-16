import * as t from "io-ts";

export type IpaCode = t.TypeOf<typeof IpaCode>;
export const IpaCode = t.string;

export type IMembership = t.TypeOf<typeof IMembership>;
export const IMembership = t.intersection([
  t.type({
    id: t.string,
    ipaCode: IpaCode,
    mainInstitution: t.boolean,
    status: t.string
  }),
  t.partial({ fiscalCode: t.string })
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

/* type Delegate = t.TypeOf<typeof Delegate>;
const Delegate = t.type({
  email: t.string,
  fiscalCode: t.string,
  id: t.string,
  role: t.string
}); */

export type TipoContratto = t.TypeOf<typeof TipoContratto>;
export const TipoContratto = t.union([
  t.literal("V1.0"),
  t.literal("V2.0"),
  t.literal("V2.2(17 giugno)"),
  t.literal("V2.2(29 luglio)")
]);

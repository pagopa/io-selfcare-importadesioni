import * as t from "io-ts";
import { EmailString, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeNumber } from "@pagopa/ts-commons/lib/numbers";
import { Context } from "@azure/functions";
import { flow, pipe } from "fp-ts/lib/function";
import { enumType } from "@pagopa/ts-commons/lib/types";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as RA from "fp-ts/lib/ReadonlyArray";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { ReadIpaData } from "./ipa";
import { Dao, IDelegate } from "./dao";
import {
  ValidationError,
  FetchMembershipError,
  FetchPecDelegatesError,
  FiscalCodeNotFoundError,
  UpsertError,
  FetchPecAttachmentError,
  SaveContractError
} from "./error";

export enum TipoContrattoEnum {
  MANUAL = "Ins. Manuale",
  V1_0 = "V1.0",
  V2_0 = "V2.0",
  V2_2__06_17 = "V2.2(17 giugno)",
  V2_2__07_29 = "V2.2(29 luglio)",
  V2_3 = "V2.3"
}

const TipoContratto = enumType<TipoContrattoEnum>(
  TipoContrattoEnum,
  "TipoContratto"
);
type TipoContratto = t.TypeOf<typeof TipoContratto>;

const PecContratto = t.interface({
  CODICEIPA: NonEmptyString,
  IDALLEGATO: NonNegativeNumber,
  TIPOCONTRATTO: TipoContratto || t.null,
  id: NonEmptyString
});

type PecContratto = t.TypeOf<typeof PecContratto>;

type MembershipDecoratedPecContract = PecContratto & {
  readonly adesioneAlreadyInsert: boolean;
};

type IpaDecoratedPecContract = PecContratto & {
  readonly isEnteCentrale: boolean;
  readonly ipaFiscalCode?: string;
};

enum TipoDelegatoEnum {
  PRINCIPALE = "Principale",
  SECONDARIO = "Secondario",
  ALTRO = "Altro"
}

const TipoDelegato = enumType<TipoDelegatoEnum>(
  TipoDelegatoEnum,
  "TipoDelegato"
);
type TipoDelegato = t.TypeOf<typeof TipoDelegato>;

const PecDelegate = t.intersection([
  t.interface({
    CODICEFISCALE: NonEmptyString,
    EMAIL: EmailString,
    IDALLEGATO: NonNegativeNumber,
    NOMINATIVO: NonEmptyString,
    TIPODELEGATO: TipoDelegato,
    id: NonEmptyString
  }),
  t.partial({ QUALIFICA: t.string })
]);

type PecDelegate = t.TypeOf<typeof PecDelegate>;

type DelegatesDecoratedPecContract = PecContratto & {
  readonly delegates: ReadonlyArray<PecDelegate>;
};

const PecAllegato = t.intersection([
  t.interface({
    NOMEALLEGATO: NonEmptyString,
    PATHALLEGATO: NonEmptyString,
    TIPOALLEGATO: t.literal("Contratto"),
    id: NonEmptyString
  }),
  t.partial({ NOMEALLEGATONUOVO: NonEmptyString })
]);

type PecAllegato = t.TypeOf<typeof PecAllegato>;

type AttachmentDecoratedPecContract = DelegatesDecoratedPecContract & {
  readonly attachment: PecAllegato;
};

const fetchMembership = (dao: Dao) => (
  contract: PecContratto
): TE.TaskEither<unknown, MembershipDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("memberships").readItemById(contract.CODICEIPA, contract.CODICEIPA),
      E.toError
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode === 200 || statusCode === 404,
        statusCode =>
          new FetchMembershipError(
            `Database find relationship by id for codiceIPA = '${contract.CODICEIPA}' failed with status code = '${statusCode}'`
          )
      )
    ),
    TE.map(statusCode => ({
      ...contract,
      adesioneAlreadyInsert: statusCode === 200
    }))
  );

const decorateFromIPA = (context: Context, readIpaData: ReadIpaData) => (
  contract: PecContratto
): TE.TaskEither<unknown, IpaDecoratedPecContract> =>
  pipe(
    TE.tryCatch(() => readIpaData(context.bindings.ipaOpenData), E.toError),
    TE.map(ipaOpenData => ({
      ...contract,
      ipaFiscalCode: ipaOpenData.get(contract.CODICEIPA),
      isEnteCentrale: ipaOpenData.has(contract.CODICEIPA)
    })),
    TE.chainEitherK(
      E.fromPredicate(
        ipaDecoratedContract =>
          !(
            ipaDecoratedContract.isEnteCentrale &&
            !ipaDecoratedContract.ipaFiscalCode
          ),
        ipaDecoratedContract =>
          new FiscalCodeNotFoundError(
            `Fiscal Code not found in IPA Open Data for IPA code '${ipaDecoratedContract.CODICEIPA}'`
          )
      )
    )
  );

const saveMembership = (dao: Dao) => (
  contract: IpaDecoratedPecContract
): TE.TaskEither<unknown, PecContratto> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("memberships").upsert({
          fiscalCode: contract.ipaFiscalCode,
          id: contract.CODICEIPA,
          ipaCode: contract.CODICEIPA,
          mainInstitution: contract.isEnteCentrale,
          status: "INITIAL"
        }),
      e => new UpsertError(String(e))
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        statusCode =>
          new UpsertError(
            `Database upsert relationship for codiceIPA = '${contract.CODICEIPA}' failed with status code = '${statusCode}'`
          )
      )
    ),
    TE.map(_ => contract)
  );

const fetchPecDelegates = (dao: Dao) => (
  contract: PecContratto
): TE.TaskEither<unknown, DelegatesDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      async () => {
        // eslint-disable-next-line functional/no-let, functional/prefer-readonly-type
        let delegates: unknown[] = [];
        // eslint-disable-next-line functional/no-let
        let response;
        do {
          response = await dao("pecDelegato").readItemsByQuery(
            {
              parameters: [{ name: "@idAllegato", value: contract.IDALLEGATO }],
              query:
                "SELECT * FROM pecDelegato d WHERE d.IDALLEGATO = *@idAllegato*"
            },
            {
              continuationToken: response
                ? response.continuationToken
                : undefined
            }
          );
          delegates = delegates.concat(response.resources);
        } while (response.hasMoreResults);
        return delegates;
      },
      e =>
        new FetchPecDelegatesError(
          `Failed to fetch delegates for attachment id = ${
            contract.IDALLEGATO
          }. Reason: ${String(e)}`
        )
    ),
    TE.chainEitherK(
      flow(
        RA.map(
          flow(
            PecDelegate.decode,
            E.mapLeft(e => new ValidationError(readableReport(e)))
          )
        ),
        E.sequenceArray // TODO: how to "accumulate" errors?
      )
    ),
    TE.map(delegates => ({ ...contract, delegates }))
  );

const fetchPecAttachment = (dao: Dao) => (
  contract: DelegatesDecoratedPecContract
): TE.TaskEither<unknown, AttachmentDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("pecAllegato").readItemById(
          contract.IDALLEGATO.toString(),
          contract.IDALLEGATO
        ),
      e => new FetchPecAttachmentError(String(e))
    ),
    TE.chainEitherK(
      E.fromPredicate(
        response => response.statusCode >= 200 && response.statusCode < 300,
        response =>
          new FetchPecAttachmentError(
            `Database find pecAllegato by id = '${contract.IDALLEGATO}' failed with status code = '${response.statusCode}'`
          )
      )
    ),
    TE.chainEitherK(
      flow(
        response => response.resource,
        PecAllegato.decode,
        E.mapLeft(e => new ValidationError(readableReport(e)))
      )
    ),
    TE.map(pecAttachment => ({ ...contract, attachment: pecAttachment }))
  );

const saveContract = (dao: Dao) => (
  contract: AttachmentDecoratedPecContract
): TE.TaskEither<unknown, void> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("contracts").upsert({
          attachment: {
            id: contract.attachment.id,
            kind: contract.attachment.TIPOALLEGATO,
            name: contract.attachment.NOMEALLEGATONUOVO
              ? contract.attachment.NOMEALLEGATONUOVO
              : contract.attachment.NOMEALLEGATO,
            path: contract.attachment.PATHALLEGATO
          },
          delegates: contract.delegates.map(
            (delegate): IDelegate => ({
              attachmentId: delegate.IDALLEGATO,
              email: delegate.EMAIL,
              firstName: delegate.NOMINATIVO.slice(
                0,
                delegate.NOMINATIVO.indexOf(" ") === -1
                  ? undefined
                  : delegate.NOMINATIVO.indexOf(" ")
              ).trim(),
              fiscalCode: delegate.CODICEFISCALE,
              id: delegate.id,
              kind: delegate.TIPODELEGATO,
              lastName: delegate.NOMINATIVO.slice(
                delegate.NOMINATIVO.indexOf(" ") + 1
              ).trim(),
              role: delegate.QUALIFICA
            })
          ),
          id: contract.id,
          ipaCode: contract.CODICEIPA,
          version: contract.TIPOCONTRATTO
        }),
      e => new SaveContractError(String(e))
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        statusCode =>
          new SaveContractError(
            `Database upsert contracts for codiceIPA = '${contract.CODICEIPA}' and id = '${contract.id}' failed with status code = '${statusCode}'`
          )
      )
    ),
    TE.map(_ => void 0)
  );

const OnContractChangeHandler = (dao: Dao, readIpaData: ReadIpaData) => async (
  context: Context,
  documents: unknown
): Promise<ReadonlyArray<void>> =>
  pipe(
    Array.isArray(documents) ? documents : [documents],
    RA.map(
      flow(
        PecContratto.decode,
        E.mapLeft(e => new ValidationError(readableReport(e))),
        TE.fromEither,
        TE.chain(c =>
          !c.TIPOCONTRATTO || c.TIPOCONTRATTO === TipoContrattoEnum.MANUAL
            ? TE.right(void 0) // TODO: add custom telemetry
            : pipe(
                c,
                fetchMembership(dao),
                TE.chain(membershipDecoratedContract =>
                  membershipDecoratedContract.adesioneAlreadyInsert
                    ? TE.right(membershipDecoratedContract)
                    : pipe(
                        membershipDecoratedContract,
                        decorateFromIPA(context, readIpaData),
                        TE.chain(saveMembership(dao))
                      )
                ),
                TE.chain(
                  flow(
                    fetchPecDelegates(dao),
                    TE.chain(fetchPecAttachment(dao)),
                    TE.chain(saveContract(dao))
                  )
                )
              )
        )
      )
    ),
    RA.sequence(TE.ApplicativePar),
    TE.getOrElse(err => {
      throw err instanceof Error ? err : new Error(`${err}`);
    })
  )();

export default OnContractChangeHandler;
import * as t from "io-ts";
import { EmailString, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeNumber } from "@pagopa/ts-commons/lib/numbers";
import { Context } from "@azure/functions";
import { flow, pipe } from "fp-ts/lib/function";
import { enumType } from "@pagopa/ts-commons/lib/types";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";
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
  CODICEIPA: t.string,
  IDALLEGATO: NonNegativeNumber,
  TIPOCONTRATTO: TipoContratto,
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

const fetchMembership = (context: Context, dao: Dao) => (
  contract: PecContratto
): TE.TaskEither<unknown, MembershipDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("memberships").readItemById(contract.CODICEIPA, contract.CODICEIPA),
      e => {
        const errorMessage = `Database find relationship by id for codiceIPA = '${
          contract.CODICEIPA
        }' failed. Reason: ${String(e)}`;
        context.log.error(errorMessage);
        return new FetchMembershipError(errorMessage);
      }
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode === 200 || statusCode === 404,
        statusCode => {
          const errorMessage = `Database find relationship by id for codiceIPA = '${contract.CODICEIPA}' failed. Reason: status code = '${statusCode}'`;
          context.log.error(errorMessage);
          return new FetchMembershipError(errorMessage);
        }
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
    TE.tryCatch(
      () => readIpaData(context.bindings.ipaOpenData),
      e => {
        const errorMessage = `Failed to read IPA Open Data, Reason ${String(
          e
        )}`;
        context.log.error(errorMessage);
        return new Error(errorMessage);
      }
    ),
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
        ipaDecoratedContract => {
          const errorMessage = `Fiscal Code not found in IPA Open Data for IPA code '${ipaDecoratedContract.CODICEIPA}'`;
          context.log.error(errorMessage);
          return new FiscalCodeNotFoundError(errorMessage);
        }
      )
    )
  );

const saveMembership = (context: Context, dao: Dao) => (
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
      e => {
        const errorMessage = `Database upsert relationship for codiceIPA = '${
          contract.CODICEIPA
        }' failed. Reason: status code = '${String(e)}'`;
        context.log.error(errorMessage);
        return new UpsertError(errorMessage);
      }
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        statusCode => {
          const errorMessage = `Database upsert relationship for codiceIPA = '${contract.CODICEIPA}' failed. Reason: status code = '${statusCode}'`;
          context.log.error(errorMessage);
          return new UpsertError(errorMessage);
        }
      )
    ),
    TE.map(_ => contract)
  );

const fetchPecDelegates = (context: Context, dao: Dao) => (
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
      e => {
        const errorMessage = `Failed to fetch delegates for attachment id = ${
          contract.IDALLEGATO
        }. Reason: ${String(e)}`;
        context.log.error(errorMessage);
        return new FetchPecDelegatesError(errorMessage);
      }
    ),
    TE.chainEitherK(
      flow(
        RA.map(
          flow(
            PecDelegate.decode,
            E.mapLeft(e => {
              const errorMessage = readableReport(e);
              context.log.error(errorMessage);
              return new ValidationError(errorMessage);
            })
          )
        ),
        E.sequenceArray // TODO: how to "accumulate" errors?
      )
    ),
    TE.map(delegates => ({ ...contract, delegates }))
  );

const fetchPecAttachment = (context: Context, dao: Dao) => (
  contract: DelegatesDecoratedPecContract
): TE.TaskEither<unknown, AttachmentDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("pecAllegato").readItemById(
          contract.IDALLEGATO.toString(),
          contract.IDALLEGATO
        ),
      e => {
        const errorMessage = `Database find pecAllegato by id = '${
          contract.IDALLEGATO
        }'. Reason: status code = '${String(e)}'`;
        context.log.error(errorMessage);
        return new FetchPecAttachmentError(errorMessage);
      }
    ),
    TE.chainEitherK(
      E.fromPredicate(
        response => response.statusCode >= 200 && response.statusCode < 300,
        response => {
          const errorMessage = `Database find pecAllegato by id = '${contract.IDALLEGATO}'. Reason: status code = '${response.statusCode}'`;
          context.log.error(errorMessage);
          return new FetchPecAttachmentError(errorMessage);
        }
      )
    ),
    TE.chainEitherK(
      flow(
        response => response.resource,
        PecAllegato.decode,
        E.mapLeft(errors => {
          const errorMessage = readableReport(errors);
          context.log.error(errorMessage);
          return new ValidationError(errorMessage);
        })
      )
    ),
    TE.map(pecAttachment => ({ ...contract, attachment: pecAttachment }))
  );

const saveContract = (context: Context, dao: Dao) => (
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
      e => {
        const errorMessage = `Database upsert contracts for codiceIPA = '${
          contract.CODICEIPA
        }' and id = '${contract.id}' failed. Reason: status code = '${String(
          e
        )}'`;
        context.log.error(errorMessage);
        return new SaveContractError();
      }
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        statusCode => {
          const errorMessage = `Database upsert contracts for codiceIPA = '${contract.CODICEIPA}' and id = '${contract.id}' failed. Reason: status code = '${statusCode}'`;
          context.log.error(errorMessage);
          return new SaveContractError(errorMessage);
        }
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
        O.fromPredicate(
          document =>
            document.TIPOCONTRATTO && document.TIPOCONTRATTO !== "Ins. Manuale"
        ),
        O.fold(
          () => {
            // TODO: add custom telemetry?
            context.log.info(`TIPOCONTRATTO not allowed. Skip item!`);
            return TE.right(void 0);
          },
          flow(
            PecContratto.decode,
            E.mapLeft(errors => new ValidationError(readableReport(errors))),
            TE.fromEither,
            TE.chain(pecContract =>
              pipe(
                {
                  ...pecContract,
                  CODICEIPA: pecContract.CODICEIPA.toLowerCase()
                },
                fetchMembership(context, dao),
                TE.chain(membershipDecoratedContract =>
                  membershipDecoratedContract.adesioneAlreadyInsert
                    ? TE.right(membershipDecoratedContract)
                    : pipe(
                        membershipDecoratedContract,
                        decorateFromIPA(context, readIpaData),
                        TE.chain(saveMembership(context, dao))
                      )
                ),
                TE.chain(
                  flow(
                    fetchPecDelegates(context, dao),
                    TE.chain(fetchPecAttachment(context, dao)),
                    TE.chain(saveContract(context, dao))
                  )
                )
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

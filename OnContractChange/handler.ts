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
import { IpaOpenData, IpaDataReader } from "./ipa";
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
  CODICEIPA: NonEmptyString,
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

const logMessage = (
  log: (...args: ReadonlyArray<unknown>) => void,
  errorMessage: string
): string => {
  log(errorMessage);
  return errorMessage;
};

const fetchMembership = (context: Context, dao: Dao) => (
  contract: PecContratto
): TE.TaskEither<unknown, MembershipDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () => dao("memberships").readItemById(contract.CODICEIPA),
      flow(
        error =>
          `Database find relationship by id for codiceIPA = '${
            contract.CODICEIPA
          }' failed. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new FetchMembershipError(errorMessage)
      )
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode === 200 || statusCode === 404,
        flow(
          statusCode =>
            `Database find relationship by id for codiceIPA = '${contract.CODICEIPA}' failed. Reason: status code = '${statusCode}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new FetchMembershipError(errorMessage)
        )
      )
    ),
    TE.map(statusCode => ({
      ...contract,
      adesioneAlreadyInsert: statusCode === 200
    }))
  );

const decorateFromIPA = (context: Context, ipaOpenData: IpaOpenData) => (
  contract: PecContratto
): TE.TaskEither<unknown, IpaDecoratedPecContract> =>
  pipe(
    {
      ...contract,
      ipaFiscalCode: ipaOpenData.get(contract.CODICEIPA),
      isEnteCentrale: ipaOpenData.has(contract.CODICEIPA)
    },
    TE.right,
    TE.chainEitherK(
      E.fromPredicate(
        ipaDecoratedContract =>
          !(
            ipaDecoratedContract.isEnteCentrale &&
            !ipaDecoratedContract.ipaFiscalCode
          ),
        flow(
          ipaDecoratedContract =>
            `Fiscal Code not found in IPA Open Data for IPA code '${ipaDecoratedContract.CODICEIPA}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new FiscalCodeNotFoundError(errorMessage)
        )
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
      flow(
        error =>
          `Database upsert relationship for codiceIPA = '${
            contract.CODICEIPA
          }' failed. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new UpsertError(errorMessage)
      )
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        flow(
          statusCode =>
            `Database upsert relationship for codiceIPA = '${contract.CODICEIPA}' failed. Reason: status code = '${statusCode}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new UpsertError(errorMessage)
        )
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
                "SELECT * FROM pecDelegato d WHERE d.IDALLEGATO = @idAllegato"
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
      flow(
        error =>
          `Failed to fetch delegates for attachment id = ${
            contract.IDALLEGATO
          }. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new FetchPecDelegatesError(errorMessage)
      )
    ),
    TE.chainEitherK(
      flow(
        RA.map(
          flow(
            PecDelegate.decode,
            E.mapLeft(
              flow(
                readableReport,
                errorMessage =>
                  logMessage(context.log.error, `PecDelegate: ${errorMessage}`),
                errorMessage => new ValidationError(errorMessage)
              )
            )
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
      () => dao("pecAllegato").readItemById(contract.IDALLEGATO.toString()),
      flow(
        error =>
          `Database find pecAllegato by id = '${
            contract.IDALLEGATO
          }'. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new FetchPecAttachmentError(errorMessage)
      )
    ),
    TE.chainEitherK(
      E.fromPredicate(
        response => response.statusCode >= 200 && response.statusCode < 300,
        flow(
          response =>
            `Database find pecAllegato by id = '${contract.IDALLEGATO}'. Reason: status code = '${response.statusCode}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new FetchPecAttachmentError(errorMessage)
        )
      )
    ),
    TE.chainEitherK(
      flow(
        response => response.resource,
        PecAllegato.decode,
        E.mapLeft(
          flow(
            readableReport,
            errorMessage =>
              logMessage(context.log.error, `PecAllegato: ${errorMessage}`),
            errorMessage => new ValidationError(errorMessage)
          )
        )
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
      flow(
        error =>
          `Database upsert contracts for codiceIPA = '${
            contract.CODICEIPA
          }' and id = '${contract.id}' failed. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new SaveContractError(errorMessage)
      )
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        flow(
          statusCode =>
            `Database upsert contracts for codiceIPA = '${contract.CODICEIPA}' and id = '${contract.id}' failed. Reason: status code = '${statusCode}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new SaveContractError(errorMessage)
        )
      )
    ),
    TE.map(_ => void 0)
  );

const HandleSingleDocument = (
  context: Context,
  dao: Dao,
  ipaOpenData: IpaOpenData
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) => (document: unknown) =>
  pipe(
    document,
    PecContratto.decode,
    E.mapLeft(
      errors => new ValidationError(`PecContratto: ${readableReport(errors)}`)
    ),
    TE.fromEither,
    TE.chain(pecContract =>
      pipe(
        {
          ...pecContract,
          CODICEIPA: pecContract.CODICEIPA.toLowerCase() as NonEmptyString
        },
        x => x,
        fetchMembership(context, dao),
        TE.chain(membershipDecoratedContract =>
          membershipDecoratedContract.adesioneAlreadyInsert
            ? TE.right(membershipDecoratedContract)
            : pipe(
                membershipDecoratedContract,
                decorateFromIPA(context, ipaOpenData),
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
  );

const OnContractChangeHandler = (
  dao: Dao,
  readIpaData: IpaDataReader
) => async (
  context: Context,
  documents: unknown
): Promise<ReadonlyArray<void>> =>
  pipe(
    readIpaData,
    TE.chain(ipaOpenData =>
      pipe(
        Array.isArray(documents) ? documents : [documents],
        RA.filter(document =>
          pipe(
            TipoContratto.decode(document.TIPOCONTRATTO),
            E.mapLeft(_ =>
              context.log.info(
                `TIPOCONTRATTO = '${document.TIPOCONTRATTO}' not allowed. Skip item!`
              )
            ),
            E.isRight
          )
        ),
        RA.map(HandleSingleDocument(context, dao, ipaOpenData)),
        RA.sequence(TE.ApplicativePar)
      )
    ),
    TE.getOrElse(err => {
      throw err instanceof Error ? err : new Error(`${err}`);
    })
  )();

export default OnContractChangeHandler;

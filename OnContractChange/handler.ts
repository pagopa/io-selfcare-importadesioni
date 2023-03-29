import { Context } from "@azure/functions";
import { NonNegativeNumber } from "@pagopa/ts-commons/lib/numbers";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { flow, pipe } from "fp-ts/lib/function";
import * as t from "io-ts";

import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { withDefault } from "@pagopa/ts-commons/lib/types";
import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";
import * as RA from "fp-ts/lib/ReadonlyArray";
import * as TE from "fp-ts/lib/TaskEither";
import { Dao } from "../models/dao";
import {
  FetchMembershipError,
  FetchPecAttachmentError,
  FetchPecEmailError,
  FetchPecSoggettoAggregatoError,
  FiscalCodeNotFoundError,
  SaveContractError,
  UpsertError,
  ValidationError
} from "../models/error";
import { ContractVersion } from "../models/types";
import { FiscalCode, IIpaOpenData, IpaDataReader } from "./ipa";

const PecContratto = t.interface({
  CODICEFISCALE: t.union([t.string, t.null]),
  CODICEIPA: withDefault(t.string, ""),
  IDALLEGATO: NonNegativeNumber,
  IDEMAIL: NonNegativeNumber,
  TIPOCONTRATTO: ContractVersion,
  id: NonEmptyString
});
type PecContratto = t.TypeOf<typeof PecContratto>;

const PecEmail = t.type({
  COMUNECODICEFISCALE: t.union([t.string, t.null]),
  COMUNECODICEIPA: withDefault(t.string, ""),
  DATAEMAIL: NonEmptyString
});
type PecEmail = t.TypeOf<typeof PecEmail>;

type EmailDecoratedPecContract = PecContratto & PecEmail;

const IpaRetrievedData = t.intersection([
  t.type({ ipaCode: NonEmptyString }),
  t.union([
    t.intersection([
      t.type({
        isEnteCentrale: t.literal(false)
      }),
      t.partial({ ipaFiscalCode: NonEmptyString })
    ]),
    t.type({
      ipaFiscalCode: NonEmptyString,
      isEnteCentrale: t.literal(true)
    })
  ])
]);
type IpaDecoratedPecContract = EmailDecoratedPecContract &
  t.TypeOf<typeof IpaRetrievedData>;

type MembershipDecoratedPecContract = IpaDecoratedPecContract & {
  readonly adesioneAlreadyInsert: boolean;
};

const PecAllegato = t.intersection([
  t.type({
    NOMEALLEGATO: NonEmptyString,
    PATHALLEGATO: NonEmptyString,
    TIPOALLEGATO: t.union([t.literal("Contratto"), t.literal("Altro")]),
    id: NonEmptyString
  }),
  t.partial({ NOMEALLEGATONUOVO: NonEmptyString })
]);
type PecAllegato = t.TypeOf<typeof PecAllegato>;

type AttachmentDecoratedPecContract = IpaDecoratedPecContract & {
  readonly attachment: PecAllegato;
};

type AggregatorDecoratedPecContract = AttachmentDecoratedPecContract & {
  readonly isAggregator: boolean;
};

const logMessage = (
  log: (...args: ReadonlyArray<unknown>) => void,
  errorMessage: string
): string => {
  log(errorMessage);
  return errorMessage;
};

const fetchPecEmail = (context: Context, dao: Dao) => (
  contract: PecContratto
): TE.TaskEither<unknown, EmailDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () => dao("pecEmail").readItemById(contract.IDEMAIL.toString()),
      flow(
        error =>
          `Database find pecEmail by id = '${
            contract.IDEMAIL
          }'. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new FetchPecEmailError(errorMessage)
      )
    ),
    TE.chainEitherK(
      E.fromPredicate(
        response => response.statusCode >= 200 && response.statusCode < 300,
        flow(
          response =>
            `Database find pecEmail by id = '${contract.IDEMAIL}'. Reason: status code = '${response.statusCode}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new FetchPecEmailError(errorMessage)
        )
      )
    ),
    TE.chainEitherK(
      flow(
        response => response.resource,
        PecEmail.decode,
        E.mapLeft(
          flow(
            readableReport,
            errorMessage =>
              logMessage(context.log.error, `PecEmail: ${errorMessage}`),
            errorMessage => new ValidationError(errorMessage)
          )
        )
      )
    ),
    TE.map(pecEmail => ({
      ...contract,
      COMUNECODICEFISCALE: pecEmail.COMUNECODICEFISCALE,
      COMUNECODICEIPA: pecEmail.COMUNECODICEIPA,
      DATAEMAIL: pecEmail.DATAEMAIL
    }))
  );

const parseAndVerify = (ipaOpenData: IIpaOpenData) => (
  fiscalCode: FiscalCode
): O.Option<FiscalCode> =>
  pipe(
    fiscalCode.match(/(?<!\d)[0-9]{11}(?!\d)/g),
    O.fromNullable,
    O.map(RA.filter(ipaOpenData.hasFiscalCode)),
    O.chain(RA.head)
  );

const getIpaCode = (
  contract: EmailDecoratedPecContract,
  ipaOpenData: IIpaOpenData
): string =>
  pipe(
    contract.CODICEIPA.toLowerCase().trim(),
    O.fromPredicate(ipaOpenData.hasIpaCode),
    O.getOrElse(() =>
      pipe(
        contract.COMUNECODICEIPA.toLowerCase().trim(),
        O.fromPredicate(ipaOpenData.hasIpaCode),
        O.getOrElse(() =>
          pipe(
            contract.CODICEFISCALE,
            O.fromNullable,
            O.map(fiscalCode => fiscalCode.trim()),
            O.chain(parseAndVerify(ipaOpenData)),
            O.fold(
              () =>
                pipe(
                  contract.COMUNECODICEFISCALE,
                  O.fromNullable,
                  O.map(fiscalCode => fiscalCode.trim()),
                  O.chain(parseAndVerify(ipaOpenData)),
                  O.fold(
                    () =>
                      pipe(
                        contract.CODICEIPA.toLowerCase()
                          .trim()
                          .replace("-", "_"),
                        O.fromPredicate(ipaOpenData.hasIpaCode),
                        O.fold(() => undefined, t.identity)
                      ),
                    ipaOpenData.getIpaCode
                  )
                ),
              ipaOpenData.getIpaCode
            )
          )
        )
      )
    ),
    O.fromNullable,
    O.getOrElse(() =>
      contract.CODICEIPA ? contract.CODICEIPA.toLowerCase() : "null"
    )
  );

const decorateFromIPA = (context: Context, ipaOpenData: IIpaOpenData) => (
  contract: EmailDecoratedPecContract
): E.Either<unknown, IpaDecoratedPecContract> =>
  pipe(getIpaCode(contract, ipaOpenData), ipaCode =>
    pipe(
      {
        ipaCode,
        ipaFiscalCode: ipaOpenData.getFiscalCode(ipaCode),
        isEnteCentrale: ipaOpenData.hasIpaCode(ipaCode)
      },
      IpaRetrievedData.decode,
      E.mapLeft(
        flow(
          readableReport,
          msg =>
            `decorateFromIPA|Invalid contract (id = ${contract.id}) for CODIPA: ${ipaCode}, error: ${msg}`,
          errorMessage => logMessage(context.log.error, errorMessage),
          // validation may fail if, for an "ente centrale", no fiscal code is provided
          errorMessage => new FiscalCodeNotFoundError(errorMessage)
        )
      ),
      E.map(ipaRetrievedData => ({
        ...contract,
        ...ipaRetrievedData
      }))
    )
  );

const fetchMembership = (context: Context, dao: Dao) => (
  contract: IpaDecoratedPecContract
): TE.TaskEither<unknown, MembershipDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () => dao("memberships").readItemById(contract.ipaCode),
      flow(
        error =>
          `Database find relationship by id for codiceIPA = '${
            contract.ipaCode
          }' and contractId = '${contract.id}' failed failed. Reason: ${String(
            error
          )}`,
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
            `Database find relationship by id for codiceIPA = '${contract.ipaCode}' and contractId = '${contract.id}' failed failed. Reason: status code = '${statusCode}'`,
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

const saveMembership = (context: Context, dao: Dao) => (
  contract: MembershipDecoratedPecContract
): TE.TaskEither<unknown, IpaDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("memberships").upsert({
          fiscalCode: contract.ipaFiscalCode,
          id: contract.ipaCode,
          ipaCode: contract.ipaCode,
          mainInstitution: contract.isEnteCentrale,
          status: "Initial"
        }),
      flow(
        error =>
          `Database upsert relationship for codiceIPA = '${
            contract.ipaCode
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
            `Database upsert relationship for codiceIPA = '${contract.ipaCode}' failed. Reason: status code = '${statusCode}'`,
          errorMessage => logMessage(context.log.error, errorMessage),
          errorMessage => new UpsertError(errorMessage)
        )
      )
    ),
    TE.map(_ => contract)
  );

const fetchPecAttachment = (context: Context, dao: Dao) => (
  contract: IpaDecoratedPecContract
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
            `Database find pecAllegato by id = '${contract.IDALLEGATO} for contract id = '${contract.id}'. Reason: status code = '${response.statusCode}'`,
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

const checkAggregator = (context: Context, dao: Dao) => (
  contract: AttachmentDecoratedPecContract
): TE.TaskEither<unknown, AggregatorDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("pecSoggettoAggregato").readItemsByQuery({
          parameters: [{ name: "@idAllegato", value: contract.IDALLEGATO }],
          query:
            "SELECT * FROM pecSoggettoAggregato d WHERE d.IDALLEGATO = @idAllegato"
        }),
      flow(
        error =>
          `Database fetch pecSoggettoAggregato by IDALLEGATO = '${
            contract.IDALLEGATO
          }' for contract id = '${contract.id}'. Reason: ${String(error)}`,
        errorMessage => logMessage(context.log.error, errorMessage),
        errorMessage => new FetchPecSoggettoAggregatoError(errorMessage)
      )
    ),
    TE.map(response =>
      pipe(
        response.resources,
        O.fromNullable,
        O.map(items => items.length > 0),
        O.getOrElse(() => false),
        isAggregator => ({
          ...contract,
          isAggregator
        })
      )
    )
  );

const saveContract = (context: Context, dao: Dao) => (
  contract: AggregatorDecoratedPecContract
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
          emailDate: contract.DATAEMAIL,
          id: contract.id,
          ipaCode: contract.ipaCode,
          isAggregator: contract.isAggregator,
          version: contract.TIPOCONTRATTO
        }),
      flow(
        error =>
          `Database upsert contracts for codiceIPA = '${
            contract.ipaCode
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
            `Database upsert contracts for codiceIPA = '${contract.ipaCode}' and id = '${contract.id}' failed. Reason: status code = '${statusCode}'`,
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
  ipaOpenData: IIpaOpenData
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
) => (document: unknown) =>
  pipe(
    document,
    PecContratto.decode,
    E.mapLeft(
      errors => new ValidationError(`PecContratto: ${readableReport(errors)}`)
    ),
    E.map(contract => {
      context.log.info(`Processing contract with id = ${contract.id}`);
      return contract;
    }),
    TE.fromEither,
    TE.chain(
      flow(
        fetchPecEmail(context, dao),
        TE.chainEitherK(decorateFromIPA(context, ipaOpenData)),
        TE.chain(fetchMembership(context, dao)),
        TE.chain(membershipDecoratedContract =>
          membershipDecoratedContract.adesioneAlreadyInsert
            ? TE.right(membershipDecoratedContract)
            : pipe(membershipDecoratedContract, saveMembership(context, dao))
        ),
        TE.chain(
          flow(
            fetchPecAttachment(context, dao),
            TE.chain(checkAggregator(context, dao)),
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
            NonNegativeNumber.decode(document.IDALLEGATO),
            E.mapLeft(_ =>
              context.log.info(
                `IDALLEGATO = '${document.IDALLEGATO}' not allowed. Skip item!`
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

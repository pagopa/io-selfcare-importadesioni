import * as t from "io-ts";
import { EmailString, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeNumber } from "@pagopa/ts-commons/lib/numbers";
import { Context } from "@azure/functions";
import { flow, pipe } from "fp-ts/lib/function";
import { enumType } from "@pagopa/ts-commons/lib/types";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as RA from "fp-ts/lib/ReadonlyArray";
import { ReadIpaData } from "./ipa";
import { Dao } from "./dao";
import {
  FetchMembershipError,
  FiscalCodeNotFoundError,
  UpsertError,
  ValidationError
} from "./error";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";

enum TipoContrattoEnum {
  // MANUAL = "Ins. Manuale",
  // null,
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

const PecContract = t.interface({
  CODICEIPA: NonEmptyString,
  ID: NonNegativeNumber,
  IDALLEGATO: NonNegativeNumber,
  IDEMAIL: NonNegativeNumber,
  TIPOCONTRATTO: TipoContratto
});

type PecContract = t.TypeOf<typeof PecContract>;

type MembershipDecoratedPecContract = PecContract & {
  readonly adesioneAlreadyInsert: boolean;
};

type IpaDecoratedPecContract = PecContract & {
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

const PecDelegate = t.interface({
  delegatoCorpoCentrale: NonNegativeNumber,
  email: EmailString,
  fiscalCode: NonEmptyString,
  id: NonNegativeNumber,
  idAllegato: NonNegativeNumber,
  idEmail: NonNegativeNumber,
  nominativo: NonEmptyString,
  pec: t.string,
  qualifica: NonEmptyString,
  tipoDelegato: TipoDelegato
});

type PecDelegate = t.TypeOf<typeof PecDelegate>;

type DelegatesDecoratedPecContract = PecContract & {
  readonly delegates: ReadonlyArray<PecDelegate>;
};

const PecAttachment = t.interface({
  id: NonNegativeNumber,
  idEmail: NonNegativeNumber,
  nomeAllegato: NonEmptyString,
  nomeAllegatoNuovo: NonEmptyString,
  pathAllegato: NonEmptyString,
  tipoAllegato: NonEmptyString
});

type PecAttachment = t.TypeOf<typeof PecAttachment>;

type AttachmentDecoratedPecContract = DelegatesDecoratedPecContract & {
  readonly attachment: PecAttachment;
};

const fetchMembership = (dao: Dao) => (
  contract: PecContract
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
          ) // FIXME: retry?
      )
    ),
    TE.map(statusCode => ({
      ...contract,
      adesioneAlreadyInsert: statusCode === 200
    }))
  );

const decorateFromIPA = (context: Context, readIpaData: ReadIpaData) => (
  contract: PecContract
): TE.TaskEither<unknown, IpaDecoratedPecContract> =>
  pipe(
    TE.tryCatch(() => readIpaData(context.bindings.ipaOpenData), E.toError),
    TE.map(ipaOpenData => {
      console.log(ipaOpenData);
      return ipaOpenData;
    }),
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
): TE.TaskEither<unknown, PecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        // TODO: what if this ope override an already processed (status = completed) membership?
        dao("memberships").upsert({
          id: contract.CODICEIPA,
          ipaCode: contract.CODICEIPA,
          mainInstitution: contract.isEnteCentrale,
          status: "INITIAL"
        }),
      E.toError
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        statusCode =>
          new UpsertError(
            `Database upsert relationship for codiceIPA = '${contract.CODICEIPA}' failed with status code = '${statusCode}'`
          ) // FIXME: retry?
      )
    ),
    TE.map(_ => contract)
  );

const fetchPecDelegates = (dao: Dao) => (
  contract: PecContract
): TE.TaskEither<unknown, DelegatesDecoratedPecContract> =>
  pipe(
    TE.tryCatch(async () => {
      // eslint-disable-next-line functional/no-let, functional/prefer-readonly-type
      let delegates: unknown[] = [];
      // eslint-disable-next-line functional/no-let
      let response;
      do {
        const continuationToken: string | undefined = response
          ? response.continuationToken
          : undefined;
        response = await dao("Delegato").readItemsByQuery(
          {
            parameters: [{ name: "@idAllegato", value: contract.IDALLEGATO }],
            query: "SELECT * FROM Delegato d WHERE d.IDALLEGATO = *@idAllegato*"
          },
          { continuationToken }
        );
        delegates = delegates.concat(response.resources);
      } while (response.hasMoreResults);
      return delegates;
    }, E.toError),
    TE.chainEitherK(
      flow(
        RA.map(flow(PecDelegate.decode, E.mapLeft(E.toError))),
        E.sequenceArray
      )
    ),
    TE.map(delegates => ({ ...contract, delegates }))
  );

const fetchPecAttachments = (dao: Dao) => (
  contract: DelegatesDecoratedPecContract
): TE.TaskEither<unknown, AttachmentDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("Allegato").readItemById(
          contract.IDALLEGATO.toString(),
          contract.IDALLEGATO
        ),
      E.toError
    ),
    TE.chainEitherK(
      E.fromPredicate(
        response => response.statusCode >= 200 && response.statusCode < 300,
        response =>
          new Error(
            `Database find attachment by id = '${contract.IDALLEGATO}' failed with status code = '${response.statusCode}'`
          ) // FIXME: retry?
      )
    ),
    TE.chainEitherK(flow(PecAttachment.decode, E.mapLeft(E.toError))),
    TE.map(pecAttachment => ({ ...contract, attachment: pecAttachment }))
  );

const saveContract = (dao: Dao) => (
  contract: AttachmentDecoratedPecContract
): TE.TaskEither<unknown, void> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("contracts").upsert({
          delegates: contract.delegates,
          id: contract.ID.toString(),
          ipaCode: contract.CODICEIPA,
          version: contract.TIPOCONTRATTO
        }),
      E.toError
    ),
    TE.map(response => response.statusCode),
    TE.chainEitherK(
      E.fromPredicate(
        statusCode => statusCode >= 200 && statusCode < 300,
        statusCode =>
          new Error(
            `Database upsert contracts for codiceIPA = '${contract.CODICEIPA}' and id = '${contract.ID}' failed with status code = '${statusCode}'`
          ) // FIXME: retry?
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
        PecContract.decode,
        E.mapLeft(e => new ValidationError(readableReport(e))),
        TE.fromEither,
        TE.chain(fetchMembership(dao)),
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
            TE.chain(fetchPecAttachments(dao)),
            TE.chain(saveContract(dao))
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

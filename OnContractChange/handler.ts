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
  codiceIPA: NonEmptyString,
  id: NonNegativeNumber,
  idAllegato: NonNegativeNumber,
  idEmail: NonNegativeNumber,
  tipoContratto: TipoContratto
});

type PecContract = t.TypeOf<typeof PecContract>;

type MembershipDecoratedPecContract = PecContract & {
  readonly adesioneAlreadyInsert: boolean;
};

type IpaDecoratedPecContract = PecContract & {
  readonly isEnteCentrale: boolean;
  readonly ipaFiscalCode: string;
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
): TE.TaskEither<Error, MembershipDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("memberships").readItemById(contract.codiceIPA, contract.codiceIPA),
      E.toError
    ),
    TE.map(response => response.statusCode),
    TE.chain(
      flow(
        E.fromPredicate(
          statusCode => statusCode === 200 || statusCode === 404,
          statusCode =>
            new Error(
              `Database find relationship by id for codiceIPA = '${contract.codiceIPA}' failed with status code = '${statusCode}'`
            ) // FIXME: retry?
        ),
        TE.fromEither
      )
    ),
    TE.map(statusCode => ({
      ...contract,
      adesioneAlreadyInsert: statusCode === 200
    }))
  );

const decorateFromIPA = (context: Context, readIpaData: ReadIpaData) => (
  contract: PecContract
): TE.TaskEither<Error, IpaDecoratedPecContract> =>
  pipe(
    TE.tryCatch(() => readIpaData(context.bindings.ipaOpenData), E.toError),
    TE.bindTo("ipaOpenData"),
    TE.bind("ipaDecoratedContract", ({ ipaOpenData }) =>
      TE.of({
        ...contract,
        isEnteCentrale: ipaOpenData.has(contract.codiceIPA)
      })
    ),
    TE.chain(({ ipaOpenData, ipaDecoratedContract }) =>
      pipe(
        ipaDecoratedContract.codiceIPA,
        ipaOpenData.get,
        E.fromNullable(
          new Error(
            `Fiscal Code not found in IPA Open Data for IPA code '${ipaDecoratedContract.codiceIPA}'`
          )
        ),
        E.map(fiscalCode => ({
          ...ipaDecoratedContract,
          ipaFiscalCode: fiscalCode
        })),
        TE.fromEither
      )
    )
  );

const saveMembership = (dao: Dao) => (
  contract: IpaDecoratedPecContract
): TE.TaskEither<Error, PecContract> =>
  pipe(
    TE.tryCatch(() => dao("memberships").upsert(contract), E.toError),
    TE.map(response => response.statusCode),
    TE.chain(
      flow(
        E.fromPredicate(
          statusCode => statusCode >= 200 && statusCode < 300,
          statusCode =>
            new Error(
              `Database upsert relationship for codiceIPA = '${contract.codiceIPA}' failed with status code = '${statusCode}'`
            ) // FIXME: retry?
        ),
        TE.fromEither
      )
    ),
    TE.map(_ => contract)
  );

const fetchPecDelegates = (dao: Dao) => (
  contract: PecContract
): TE.TaskEither<Error, DelegatesDecoratedPecContract> =>
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
            parameters: [{ name: "@idAllegato", value: contract.idAllegato }],
            query: "SELECT * FROM Delegato d WHERE d.IDALLEGATO = *@idAllegato*"
          },
          { continuationToken }
        );
        delegates = delegates.concat(response.resources);
      } while (response.hasMoreResults);
      return delegates;
    }, E.toError),
    TE.chain(
      flow(
        RA.map(flow(PecDelegate.decode, E.mapLeft(E.toError))),
        E.sequenceArray,
        TE.fromEither
      )
    ),
    TE.map(delegates => ({ ...contract, delegates }))
  );

const fetchPecAttachments = (dao: Dao) => (
  contract: DelegatesDecoratedPecContract
): TE.TaskEither<Error, AttachmentDecoratedPecContract> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("Allegato").readItemById(
          contract.idAllegato.toString(),
          contract.idAllegato
        ),
      E.toError
    ),
    TE.chain(
      flow(
        E.fromPredicate(
          response => response.statusCode >= 200 && response.statusCode < 300,
          response =>
            new Error(
              `Database find attachment by id = '${contract.idAllegato}' failed with status code = '${response.statusCode}'`
            ) // FIXME: retry?
        ),
        TE.fromEither
      )
    ),
    TE.chain(flow(PecAttachment.decode, E.mapLeft(E.toError), TE.fromEither)),
    TE.map(pecAttachment => ({ ...contract, attachment: pecAttachment }))
  );

const saveContract = (dao: Dao) => (
  contract: AttachmentDecoratedPecContract
): TE.TaskEither<Error, void> =>
  pipe(
    TE.tryCatch(() => dao("contracts").upsert(contract), E.toError),
    TE.map(response => response.statusCode),
    TE.chain(
      flow(
        E.fromPredicate(
          statusCode => statusCode >= 200 && statusCode < 300,
          statusCode =>
            new Error(
              `Database upsert contracts for codiceIPA = '${contract.codiceIPA}' and id = '${contract.id}' failed with status code = '${statusCode}'`
            ) // FIXME: retry?
        ),
        TE.fromEither
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
        E.mapLeft(E.toError),
        TE.fromEither, // TODO: is it necessary/required?
        TE.chain(fetchMembership(dao)), // FIXME: return a boolean instead of an AdesioneDecoratedContractRecord?
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

import * as t from "io-ts";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { NonNegativeNumber } from "@pagopa/ts-commons/lib/numbers";
import {
  NotImplementedError,
  ValidationError
} from "../OnContractChange/error";
import { withJsonInput } from "../utils/misc";
import { Dao } from "../OnContractChange/dao";
import { TipoDelegatoEnum } from "../OnContractChange/handler";

type IpaCode = t.TypeOf<typeof IpaCode>;
const IpaCode = t.string;

type QueueItem = t.TypeOf<typeof QueueItem>;
const QueueItem = t.type({
  ipaCode: IpaCode
});

type Membership = t.TypeOf<typeof Membership>;
const Membership = t.type({
  fiscalCode: t.string,
  id: t.string,
  ipaCode: t.string,
  mainInstitution: t.boolean,
  status: t.string
});

type Delegate = t.TypeOf<typeof Contract>;
const Delegate = t.type({
  email: t.string,
  fiscalCode: t.string,
  id: t.string,
  role: t.string
});

type Contract = t.TypeOf<typeof Contract>;
const Contract = t.type({
  CODICEIPA: IpaCode,
  IDALLEGATO: NonNegativeNumber,
  id: t.string
});

type ContractWithDelegates = t.TypeOf<typeof ContractWithDelegates>;
const ContractWithDelegates = t.intersection([
  Contract,
  t.type({
    delegates: t.readonlyArray(Delegate)
  })
]);

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type SelfCareMembershipClaimParams = {
  // TBD
};

// retrieve the list of contracts relative to a Membership, identified by its ipa code
const fetchContractsByIpaCode = (dao: Dao) => (
  ipaCode: IpaCode
): TE.TaskEither<Error, ReadonlyArray<Contract>> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("contracts").readAllItemsByQuery({
          parameters: [{ name: "@ipaCode", value: ipaCode }],
          query: "SELECT * FROM contracts d WHERE d.ipaCode = @ipaCode"
        }),
      E.toError
    ),
    TE.chain(
      flow(
        t.readonlyArray(Contract).decode,
        TE.fromEither,
        TE.mapLeft(flow(readableReport, E.toError))
      )
    )
  );

// Given a list of contracts, get the sublist of the ones we should consider in our process
const selectContract = (contracts: ReadonlyArray<Contract>): Contract =>
  contracts[0];

const retrieveDelegates = (dao: Dao) => (
  contract: Contract
): TE.TaskEither<Error, ContractWithDelegates> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("pecDelegato").readAllItemsByQuery({
          parameters: [{ name: "@IDALLEGATO", value: contract.IDALLEGATO }],
          query: "SELECT * FROM pecDelegato d WHERE d.IDALLEGATO = @IDALLEGATO"
        }),
      E.toError
    ),
    TE.chain(
      flow(
        t.readonlyArray(Delegate).decode,
        TE.fromEither,
        TE.mapLeft(flow(readableReport, E.toError))
      )
    ),
    TE.map(delegates => ({ ...contract, delegates }))
  );

// Check if a person with manager role has been declared in at least one of the contracts
const hasManager = ({ delegates }: ContractWithDelegates): boolean =>
  delegates.some(d => d.role === TipoDelegatoEnum.PRINCIPALE);

// Prepare data to be sent to SelfCare
const composeSelfCareMembershipClaim = (
  _ipaCode: IpaCode,
  _contracts: ContractWithDelegates
): SelfCareMembershipClaimParams => ({});

// Submit the claim to SelfCare to import the memebership
const submitMembershipClaimToSelfcare = (
  _selfcareConfig: unknown /* TBD */
) => (_claim: SelfCareMembershipClaimParams): TE.TaskEither<Error, void> =>
  TE.left(
    new NotImplementedError(
      "submitMembershipClaimToSelfcare() - Not implemented yet"
    )
  );

// Save that the memebeship is not meant to be processed by the current business logic
const markMembership = (dao: Dao) => (
  ipaCode: IpaCode,
  status: string
): TE.TaskEither<Error, void> =>
  pipe(
    TE.tryCatch(() => dao("memberships").readItemById(ipaCode), E.toError),
    TE.chain(
      flow(
        Membership.decode,
        TE.fromEither,
        TE.mapLeft(flow(readableReport, E.toError))
      )
    ),
    TE.chain(m =>
      TE.tryCatch(() => dao("memberships").upsert({ ...m, status }), E.toError)
    ),
    TE.map(_ => void 0)
  );

// Save that the memebeship is not meant to be processed by the current business logic
const markMembershipAsDiscarded = (dao: Dao) => (
  ipaCode: IpaCode
): TE.TaskEither<Error, void> => markMembership(dao)(ipaCode, "discarded");

// Save that the memebeship has been correctly claimed to SelfCare
const markMembershipAsCompleted = (dao: Dao) => (
  ipaCode: IpaCode
): TE.TaskEither<Error, void> => markMembership(dao)(ipaCode, "completed");

const createHandler = ({
  dao
}: {
  readonly dao: Dao;
}): ReturnType<typeof withJsonInput> =>
  pipe(
    withJsonInput((_context, queueItem) =>
      pipe(
        // parse incoming message
        pipe(
          queueItem,
          QueueItem.decode,
          E.mapLeft(flow(readableReport, _ => new ValidationError(_))),
          TE.fromEither,
          TE.map(_ => _.ipaCode)
        ),

        // fetch all contracts
        // and filter only valid ones
        TE.chain(ipaCode =>
          pipe(
            ipaCode,
            fetchContractsByIpaCode(dao),
            TE.map(selectContract),
            TE.chain(retrieveDelegates(dao)),
            TE.map(contract => ({ contract, ipaCode }))
          )
        ),

        // process membership with its contracts
        TE.chain(({ contract, ipaCode }) =>
          hasManager(contract)
            ? // only memberships with a manager can be imported
              pipe(
                composeSelfCareMembershipClaim(ipaCode, contract),
                submitMembershipClaimToSelfcare({}),
                TE.chain(_ => markMembershipAsCompleted(dao)(ipaCode))
              )
            : // otherwise, we mark the memebership as discarded for future data refinements
              markMembershipAsDiscarded(dao)(ipaCode)
        ),

        // return either an empty result or throw an error
        TE.map(_ => void 0),
        TE.getOrElse(err => {
          throw err;
        })
      )()
    )
  );

export default createHandler;

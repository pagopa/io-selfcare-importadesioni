import * as t from "io-ts";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import {
  NotImplementedError,
  ValidationError
} from "../OnContractChange/error";
import { withJsonInput } from "../utils/misc";
import { Dao } from "../OnContractChange/dao";

type IpaCode = t.TypeOf<typeof IpaCode>;
const IpaCode = t.string;

type QueueItem = t.TypeOf<typeof QueueItem>;
const QueueItem = t.type({
  ipaCode: IpaCode
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
  delegates: t.readonlyArray(Delegate),
  id: t.string,
  ipaCode: IpaCode
});

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type SelfCareMembershipClaimParams = {
  // TBD
};

// retrieve the list of contracts relative to a Membership, identified by its ipa code
const fetchContractsByIpaCode = (_dao: Dao) => (
  _ipaCode: IpaCode
): TE.TaskEither<Error, ReadonlyArray<Contract>> =>
  TE.left(
    new NotImplementedError("fetchContractsByIpaCode() - Not implemented yet")
  );

// Given a list of contracts, get the sublist of the ones we should consider in our process
const selectContract = (contracts: ReadonlyArray<Contract>): Contract =>
  contracts[0];

// Check if a person with manager role has been declared in at least one of the contracts
const hasManager = (_contract: Contract): boolean => false;

// Prepare data to be sent to SelfCare
const composeSelfCareMembershipClaim = (
  _ipaCode: IpaCode,
  _contract: Contract
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
const markMembershipAsDiscarded = (_dao: Dao) => (
  _ipaCode: IpaCode
): TE.TaskEither<Error, ReadonlyArray<Contract>> =>
  TE.left(new NotImplementedError("discardMembership() - Not implemented yet"));

// Save that the memebeship has been correctly claimed to SelfCare
const markMembershipAsCompleted = (_dao: Dao) => (
  _ipaCode: IpaCode
): TE.TaskEither<Error, ReadonlyArray<Contract>> =>
  TE.left(
    new NotImplementedError("markMembershipAsCompleted() - Not implemented yet")
  );

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

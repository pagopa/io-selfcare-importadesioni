import * as t from "io-ts";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/lib/ReadonlyArray";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { ValidationError } from "../models/error";
import { withJsonInput } from "../utils/misc";
import { Dao } from "../models/dao";
import {
  IContract,
  IContractWithDelegates,
  IMembership,
  IpaCode,
  MembershipStatus,
  PecDelegate
} from "../models/types";
import { SelfCareClient } from "../utils/selfcare";
import { RoleEnum, UserDto } from "../generated/selfcare/UserDto";
import { ImportContractDto } from "../generated/selfcare/ImportContractDto";

export type QueueItem = t.TypeOf<typeof QueueItem>;
export const QueueItem = t.type({
  fiscalCode: NonEmptyString,
  ipaCode: IpaCode
});

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type SelfCareMembershipClaimParams = Parameters<
  SelfCareClient["contractOnboardingUsingPOST"]
>[0];

// retrieve the list of contracts relative to a Membership, identified by its ipa code
const fetchContractsByIpaCode = (dao: Dao) => (
  ipaCode: IpaCode
): TE.TaskEither<Error, ReadonlyArray<IContract>> =>
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
        r => r.resources,
        t.readonlyArray(IContract).decode,
        TE.fromEither,
        TE.mapLeft(flow(readableReport, E.toError))
      )
    )
  );

// Given a list of contracts, get the sublist of the ones we should consider in our process
const selectContract = (contracts: ReadonlyArray<IContract>): IContract => {
  const orderedVersions = [
    "V1.0",
    "V2.0",
    "V2.2(17 giugno)",
    "V2.2(29 luglio)",
    "V2.3"
  ];

  return (
    [...contracts] // sort is applied in place, so we clone the array
      .map(c => ({ ...c, versionNo: orderedVersions.indexOf(c.version) }))
      // sort contracts array so that the first element is the more relevant
      .sort((a, b) => {
        if (a.versionNo > b.versionNo) {
          return -1; // a is more relevant than b, so it goes first
        } else if (a.versionNo < b.versionNo) {
          return 1; // a is less relevant than b, so it goes after
        }
        // when version is the same, we choose the latest
        else if (
          new Date(a.emailDate).getTime() > new Date(b.emailDate).getTime()
        ) {
          return -1; // a is more recent, so it goes first
        } else {
          return 1; // a is less recent, so it goes after
        }
      })[0]
  );
};

const retrieveDelegates = (dao: Dao) => (
  contract: IContract
): TE.TaskEither<Error, IContractWithDelegates> =>
  pipe(
    TE.tryCatch(
      () =>
        dao("pecDelegato").readAllItemsByQuery({
          parameters: [{ name: "@IDALLEGATO", value: contract.attachment.id }],
          query: "SELECT * FROM pecDelegato d WHERE d.IDALLEGATO = @IDALLEGATO"
        }),
      E.toError
    ),
    // consider only valid delegates
    TE.map(
      flow(
        r => r.resources,
        RA.map(PecDelegate.decode),
        RA.filter(E.isRight),
        RA.map(_ => _.right)
      )
    ),
    TE.map(delegates => ({ ...contract, delegates }))
  );

// Check if a person with manager role has been declared in at least one of the contracts
const hasManager = ({ delegates }: IContractWithDelegates): boolean =>
  delegates.some(d => d.TIPODELEGATO === "Principale");

const formatDelegateNameAndSurname = ({
  NOMINATIVO,
  CODICEFISCALE
}: PecDelegate): {
  readonly name: string;
  readonly surname: string;
} => {
  // if NOMINATIVO is given, we consider the first word as birth name and the rest as surname
  if (NOMINATIVO) {
    const [name, ...rest] = NOMINATIVO.split(" ").filter(Boolean);
    return { name, surname: rest.join(" ") };
  }
  // otherwise, we extract the first two triplets of characters from the fiscal code
  // respectively for surname and name
  else {
    const name = CODICEFISCALE.substring(3, 6);
    const surname = CODICEFISCALE.substring(0, 3);
    return { name, surname };
  }
};
const toSelfcareRole = (role: PecDelegate["TIPODELEGATO"]): UserDto["role"] => {
  if (role === "Principale") {
    return RoleEnum.MANAGER;
  }
  // Any other parsed role, we assign the DELEGATE role
  else {
    return RoleEnum.DELEGATE;
  }
};

const composeSelfcareUser = (input: PecDelegate): UserDto => ({
  email: input.EMAIL,
  role: toSelfcareRole(input.TIPODELEGATO),
  taxCode: input.CODICEFISCALE,
  ...formatDelegateNameAndSurname(input)
});

const composeSelfcareContract = (input: IContract): ImportContractDto => ({
  contractType: input.version,
  fileName: input.attachment.name,
  filePath: input.attachment.path
});

// Prepare data to be sent to SelfCare
const composeSelfCareMembershipClaim = (
  fiscalCode: NonEmptyString,
  contract: IContractWithDelegates
): SelfCareMembershipClaimParams => ({
  body: {
    importContract: composeSelfcareContract(contract),
    users: contract.delegates.map(composeSelfcareUser)
  },
  externalInstitutionId: fiscalCode
});

// Submit the claim to SelfCare to import the memebership
const submitMembershipClaimToSelfcare = (selfcareClient: SelfCareClient) => (
  claim: SelfCareMembershipClaimParams
): TE.TaskEither<Error, void> =>
  pipe(
    TE.tryCatch(
      () => selfcareClient.contractOnboardingUsingPOST(claim),
      E.toError
    ),
    TE.chain(flow(TE.fromEither, TE.mapLeft(E.toError))),
    TE.chain(_ =>
      _.status === 201
        ? TE.right(_)
        : TE.left(new Error(`Selfcare responded ${_.status}`))
    ),
    TE.map(_ => void 0)
  );

// Save that the memebeship is not meant to be processed by the current business logic
const markMembership = (dao: Dao) => (
  ipaCode: IpaCode,
  status: MembershipStatus,
  note?: string
): TE.TaskEither<Error, void> =>
  pipe(
    TE.tryCatch(() => dao("memberships").readItemById(ipaCode), E.toError),
    TE.chain(
      flow(
        r => r.resource,
        IMembership.decode,
        TE.fromEither,
        TE.mapLeft(flow(readableReport, E.toError))
      )
    ),
    TE.chain(m =>
      TE.tryCatch(
        () => dao("memberships").upsert({ ...m, note, status }),
        E.toError
      )
    ),
    TE.map(_ => void 0)
  );

// Save that the memebeship is not meant to be processed by the current business logic
const markMembershipAsDiscarded = (dao: Dao) => (
  ipaCode: IpaCode,
  note: string
): TE.TaskEither<Error, void> =>
  markMembership(dao)(ipaCode, "Discarded", note);

// Save that the memebeship has been correctly claimed to SelfCare
const markMembershipAsCompleted = (dao: Dao) => (
  ipaCode: IpaCode,
  note: string
): TE.TaskEither<Error, void> =>
  markMembership(dao)(ipaCode, "Processed", note);

const createHandler = ({
  dao,
  selfcareClient
}: {
  readonly dao: Dao;
  readonly selfcareClient: SelfCareClient;
}): ReturnType<typeof withJsonInput> =>
  pipe(
    withJsonInput((_context, queueItem) =>
      pipe(
        // parse incoming message
        pipe(
          queueItem,
          QueueItem.decode,
          E.mapLeft(flow(readableReport, _ => new ValidationError(_))),
          TE.fromEither
        ),

        // fetch all contracts
        // and filter only valid ones
        TE.chain(item =>
          pipe(
            item.ipaCode,
            fetchContractsByIpaCode(dao),
            TE.map(selectContract),
            TE.chain(retrieveDelegates(dao)),
            TE.map(contract => ({ contract, ...item }))
          )
        ),

        // process membership with its contracts
        TE.chain(({ contract, ipaCode, fiscalCode }) =>
          hasManager(contract)
            ? // only memberships with a manager can be imported
              pipe(
                composeSelfCareMembershipClaim(fiscalCode, contract),
                submitMembershipClaimToSelfcare(selfcareClient),
                TE.chain(_ =>
                  markMembershipAsCompleted(dao)(
                    ipaCode,
                    `Imported with contract id#${contract.id}`
                  )
                )
              )
            : // otherwise, we mark the memebership as discarded for future data refinements
              markMembershipAsDiscarded(dao)(
                ipaCode,
                `No manager found for contract id#${contract.id} attachement id#${contract.attachment.id}`
              )
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

/* eslint-disable sonarjs/no-duplicate-string */
import * as t from "io-ts";
import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import * as RA from "fp-ts/lib/ReadonlyArray";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import {
  FiscalCode,
  NonEmptyString,
  OrganizationFiscalCode
} from "@pagopa/ts-commons/lib/strings";
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
const selectContract = (contracts: ReadonlyArray<IContract>): IContract =>
  [...contracts] // sort is applied in place, so we clone the array
    // sort contracts array so that the first element is the more relevant
    .sort((a, b) => {
      if (new Date(a.emailDate).getTime() > new Date(b.emailDate).getTime()) {
        return -1; // a is more recent, so it goes first
      } else if (
        new Date(a.emailDate).getTime() < new Date(b.emailDate).getTime()
      ) {
        return 1; // a is less recent, so it goes after
      }
      // when date is the same, we check the type of attachment
      else if (a.attachment.kind === "Contratto") {
        return -1; // a is a Contratto, so it goes first
      } else if (b.attachment.kind === "Contratto") {
        return 1; // b is a Contratto, so a it goes after
      }
      // when date is the same, we check file extension
      else if (a.attachment.name.endsWith(".p7m")) {
        return -1; // a is a p7m, so it goes first
      } else {
        return 1; // a is not a p7m, so it goes after
      }
    })[0];

const retrieveRawDelegates = (dao: Dao) => (
  contract: IContract
): TE.TaskEither<Error, ReadonlyArray<unknown>> =>
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
    TE.map(r => r.resources)
  );

const hasKey = <K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> =>
  obj != null && typeof obj === "object" && key in obj;

// Try to fix delegate data before parsing and validation
// Add here known patches
const fixRawDelegates = (
  records: ReadonlyArray<unknown>
): ReadonlyArray<unknown> =>
  records
    // apply fixes on CODICEFISCALE
    .map(x =>
      hasKey(x, "CODICEFISCALE") && typeof x.CODICEFISCALE === "string"
        ? {
            ...x,
            CODICEFISCALE: x.CODICEFISCALE.toUpperCase() /* force uppercase */
              .replace(/\s/gi, "") /* remove spaces */
          }
        : x
    )
    // apply fixes on EMAIL
    .map(x =>
      hasKey(x, "EMAIL") && typeof x.EMAIL === "string"
        ? {
            ...x,
            EMAIL: x.EMAIL.replace(/\s/gi, "") /* remove spaces */
          }
        : x
    );

// Check if a person with manager role has been declared in at least one of the contracts
const hasManager = (delegates: IContractWithDelegates["delegates"]): boolean =>
  delegates.some(d => d.TIPODELEGATO === "Principale");

type DelegatesFailures =
  | "no-manager"
  | "no-cf"
  | "wrong-cf"
  | "wrong-cf-with-spaces"
  | "wrong-cf-lowercase"
  | "organization-cf"
  | "wrong-email"
  | "other";
const parseDelegates = (
  records: ReadonlyArray<unknown>
): E.Either<DelegatesFailures, IContractWithDelegates["delegates"]> => {
  const parsedDelegates = pipe(
    records,
    RA.map(PecDelegate.decode),
    RA.filter(E.isRight),
    RA.map(_ => _.right)
  );

  // There is at least a well-formed delegate, and it's manager
  if (hasManager(parsedDelegates)) {
    return E.right(parsedDelegates);
  }

  // Check if there is a malformed manager delegate
  const malformedManager = pipe(
    records,
    RA.map(
      t.type({
        TIPODELEGATO: t.literal("Principale")
      }).decode
    ),
    RA.filter(E.isRight),
    RA.map(_ => _.right)
  )[0];

  // no manager, even malformed
  if (!malformedManager) {
    return E.left("no-manager");
  }

  // wrong manager fiscal code
  const managerHasGoodCF = pipe(
    malformedManager,
    t.type({
      CODICEFISCALE: PecDelegate.props.CODICEFISCALE
    }).decode,
    E.isRight
  );

  // let's investigate why fiscal code is not good
  if (!managerHasGoodCF) {
    // Some delegate has the organization fiscal code instead of its own
    const managerHasOrganizationCF = pipe(
      malformedManager,
      t.type({
        CODICEFISCALE: OrganizationFiscalCode
      }).decode,
      E.isRight
    );
    if (managerHasOrganizationCF) {
      return E.left("organization-cf");
    }

    // Some delegate has no fiscal code
    if (
      "CODICEFISCALE" in malformedManager &&
      !malformedManager.CODICEFISCALE
    ) {
      return E.left("no-cf");
    }

    // Some fiscal code has spaces
    if (
      "CODICEFISCALE" in malformedManager &&
      typeof malformedManager.CODICEFISCALE === "string" &&
      malformedManager.CODICEFISCALE.indexOf(" ") > -1
    ) {
      return E.left("wrong-cf-with-spaces");
    }

    // Some fiscal code is not matched as it's lowercase
    if (
      "CODICEFISCALE" in malformedManager &&
      typeof malformedManager.CODICEFISCALE === "string" &&
      malformedManager.CODICEFISCALE.match(/[a-z]/)?.length
    ) {
      return E.left("wrong-cf-lowercase");
    }

    // Some fiscal code has simply bad pattern
    if (
      "CODICEFISCALE" in malformedManager &&
      typeof malformedManager.CODICEFISCALE === "string" &&
      pipe(malformedManager.CODICEFISCALE, FiscalCode.decode, E.isLeft)
    ) {
      return E.left("wrong-cf");
    }
  }

  // wrong manager fiscal code
  const managerHasEmail = pipe(
    malformedManager,
    t.type({
      EMAIL: PecDelegate.props.EMAIL
    }).decode,
    E.isRight
  );

  if (!managerHasEmail) {
    return E.left("wrong-email");
  }

  return E.left("other");
};

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
  contractType: input.version ? input.version : "",
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
      _ => new Error(`Failed to connect with Selfcare: ${E.toError(_).message}`)
    ),
    TE.chain(
      flow(
        TE.fromEither,
        TE.mapLeft(readableReport),
        TE.mapLeft(_ => new Error(`Unhandled response from Selfcare: ${_}`))
      )
    ),
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

const markMembershipAsFailed = (dao: Dao) => (
  ipaCode: IpaCode,
  note: string
): TE.TaskEither<Error, void> => markMembership(dao)(ipaCode, "Failed", note);

// Format a failure message
const composeFailureNote = ({ id, attachment }: IContract) => (
  failure: DelegatesFailures
): string => {
  const msg = (note: string): string =>
    `${note} | contract#${id} attachment#${attachment.id}`;
  switch (failure) {
    case "no-cf":
      return msg("Manager has empty CODICEFISCALE");
    case "no-manager":
      return msg("No manager found");
    case "organization-cf":
      return msg("Wrong CODICEFISCALE (organization pattern)");
    case "wrong-cf":
      return msg("Wrong CODICEFISCALE (bad pattern)");
    case "wrong-cf-lowercase":
      return msg("Wrong CODICEFISCALE (lowercase)");
    case "wrong-cf-with-spaces":
      return msg("Wrong CODICEFISCALE (has spaces)");
    case "wrong-email":
      return msg("Wrong EMAIL");
    case "other":
      return msg("Unknown error");
    default:
      const _: never = failure;
      return msg(`Unhandled failure: ${_}`);
  }
};

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
            TE.chainEitherK(contract =>
              pipe(
                t.string.decode(contract.version),
                E.mapLeft(flow(readableReport, E.toError)),
                E.map(_ => contract)
              )
            ),
            TE.chainEitherK(contract =>
              pipe(
                t.literal("Contratto").decode(contract.attachment.kind),
                E.mapLeft(flow(readableReport, E.toError)),
                E.map(_ => contract)
              )
            ),
            TE.map(contract => ({ contract, ...item }))
          )
        ),

        // fetch delegates and apply fix when possible
        TE.chain(_ =>
          pipe(
            _.contract,
            retrieveRawDelegates(dao),
            TE.map(fixRawDelegates),
            TE.map(rawDelegates => ({ ..._, rawDelegates }))
          )
        ),

        // Either submit or discard the membership
        TE.chain(({ fiscalCode, ipaCode, contract, rawDelegates }) =>
          pipe(
            // try to parse delegates for the contract
            // and check there every data we need
            rawDelegates,
            parseDelegates,

            E.fold(
              // When something wrong with delegates, we cannot continue
              // we mark membership ad discarded (with failure note)
              flow(composeFailureNote(contract), note =>
                markMembershipAsDiscarded(dao)(ipaCode, note)
              ),

              // If delegates satisfy requirements, we can process the membership to selfcare
              delegates =>
                pipe(
                  composeSelfCareMembershipClaim(fiscalCode, {
                    ...contract,
                    delegates
                  }),
                  submitMembershipClaimToSelfcare(selfcareClient),
                  TE.fold(
                    err =>
                      markMembershipAsFailed(dao)(
                        ipaCode,
                        `${err.message} | contract id#${contract.id}`
                      ),
                    _ =>
                      markMembershipAsCompleted(dao)(
                        ipaCode,
                        `Imported with contract id#${contract.id}`
                      )
                  )
                )
            )
          )
        ),

        // return either an empty result or throw an error
        TE.getOrElse(err => {
          throw err;
        })
      )()
    )
  );

export default createHandler;

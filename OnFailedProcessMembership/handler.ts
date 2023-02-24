import { flow, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import { readableReport } from "@pagopa/ts-commons/lib/reporters";
import { ValidationError } from "../models/error";
import { withJsonInput } from "../utils/misc";
import { Dao } from "../models/dao";
import { IMembership, IpaCode, MembershipStatus } from "../models/types";
import { QueueItem } from "../ProcessMembership/handler";

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
const markMembershipAsFailed = (dao: Dao) => (
  ipaCode: IpaCode,
  note: string
): TE.TaskEither<Error, void> => markMembership(dao)(ipaCode, "Failed", note);

// Save that the memebeship has been correctly claimed to SelfCare

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
          TE.fromEither
        ),

        TE.chain(item => markMembershipAsFailed(dao)(item.ipaCode, ".")),

        // return either an empty result or throw an error
        TE.map(_ => void 0),
        TE.getOrElse(err => {
          throw err;
        })
      )()
    )
  );

export default createHandler;

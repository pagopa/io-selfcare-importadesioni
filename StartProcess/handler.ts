/* eslint-disable @typescript-eslint/explicit-function-return-type */

import * as express from "express";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";
import {
  ResponseErrorInternal,
  ResponseSuccessAccepted
} from "@pagopa/ts-commons/lib/responses";

import { CommaSeparatedListOf } from "@pagopa/ts-commons/lib/comma-separated-list";

import { flow, pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/lib/ReadonlyArray";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";
import * as t from "io-ts";

import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import { RequiredQueryParamMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/required_query_param";
import { withDefault } from "@pagopa/ts-commons/lib/types";
import { SqlQuerySpec } from "@azure/cosmos";
import { Context } from "@azure/functions";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NumberFromString } from "@pagopa/ts-commons/lib/numbers";
import { IMembership, IpaCode, MembershipStatus } from "../models/types";
import { Dao } from "../models/dao";
import { QueueItem } from "../ProcessMembership/handler";

const composeQuery = (
  ipas: ReadonlyArray<IpaCode>,
  limit: number,
  status: MembershipStatus
): SqlQuerySpec => {
  const baseSql =
    "SELECT * FROM memberships d WHERE d.status = @status and d.mainInstitution = true";
  // when a list of IpaCodes is provides, we retrieve all of them
  if (ipas.length) {
    return {
      parameters: [
        { name: "@ipas", value: ipas },
        { name: "@status", value: status }
      ],
      query: `${baseSql} and ARRAY_CONTAINS(@ipas, d.ipaCode)`
    };
  }
  // otherwise we fetch the first elements on the selected status
  else {
    return {
      parameters: [
        { name: "@limit", value: limit },
        { name: "@status", value: status }
      ],
      query: `${baseSql} OFFSET 0 LIMIT @limit`
    };
  }
};

type MembershipWithFiscalCode = t.TypeOf<typeof MembershipWithFiscalCode>;
const MembershipWithFiscalCode = t.intersection([
  IMembership,
  t.type({ fiscalCode: NonEmptyString })
]);

const prepareQueueItem = ({
  ipaCode,
  fiscalCode
}: MembershipWithFiscalCode): QueueItem => ({
  fiscalCode,
  ipaCode
});
const dispatch = (context: Context) => (
  items: ReadonlyArray<QueueItem>
): ReadonlyArray<QueueItem> => {
  // eslint-disable-next-line functional/immutable-data
  context.bindings.processMembership = RA.map(JSON.stringify)(items);
  return items;
};

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
export function StartProcess({
  dao
}: {
  readonly dao: Dao;
}): express.RequestHandler {
  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    // list of ipa codes
    //   use this parameter to select a specic set of memberships to process
    RequiredQueryParamMiddleware(
      "ipas",
      withDefault(CommaSeparatedListOf(IpaCode), [])
    ),
    // limit the number of membership processed
    //   applied only if ipas is not defined
    RequiredQueryParamMiddleware(
      "limit",
      withDefault(
        NumberFromString,
        // FIXME: withDefault has a buggy defintion, it expects the output type but it actually uses the input type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "100" as any
      )
    ),
    // the processing status of the memebership we query
    //  applied both whe querying by ipa codes or with limit
    RequiredQueryParamMiddleware(
      "status",
      withDefault(MembershipStatus, "Initial")
    )
  );
  return wrapRequestHandler(
    middlewaresWrap(async (context, ipas, limit, status) =>
      pipe(
        composeQuery(ipas, limit, status),
        query =>
          TE.tryCatch(
            async () => dao("memberships").readAllItemsByQuery(query),
            _ =>
              ResponseErrorInternal(
                `Failed to query database, error: ${E.toError(_).message}`
              )
          ),
        TE.map(r => r.resources),
        // consider only valid memebership objects
        TE.map(
          flow(
            RA.map(MembershipWithFiscalCode.decode),
            RA.filter(E.isRight),
            RA.map(_ => _.right)
          )
        ),
        TE.map(RA.map(prepareQueueItem)),
        TE.map(dispatch(context)),
        TE.map(items =>
          ResponseSuccessAccepted(
            `Processing ${items.length} of elements`,
            items.map(_ => _.ipaCode)
          )
        ),
        TE.toUnion
      )()
    )
  );
}

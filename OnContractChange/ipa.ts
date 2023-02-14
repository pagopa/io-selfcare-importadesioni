/**
 * Utility functions to read data from IPA Open Data (CSV formatted).
 */
import { parse } from "csv-parse/sync";
import { getBlobAsText } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";
import { pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";
import * as E from "fp-ts/lib/Either";

export type IpaCode = string;
export type FiscalCode = string;
/**
 * A map representing organizations retrieved from IPA, with the IPA code as the key and the corresponding tax code as the value.
 */
export type IpaOpenData = ReadonlyMap<IpaCode, FiscalCode>;

/**
 * Read data from a {@link string} and transform its content into an {@link IpaOpenData} instance
 *
 * @param stream a row string of IPA Open Data (CSV formatted)
 * @returns an {@link IpaOpenData} instance
 */
export const parseIpaData = async (data: string): Promise<IpaOpenData> => {
  const ipaCode2FiscalCode = new Map<string, string>();
  const records: ReadonlyArray<ReadonlyArray<string>> = parse(data, {
    from_line: 2
  });
  records.forEach(row => ipaCode2FiscalCode.set(row[1], row[3]));
  return ipaCode2FiscalCode;
};

/**
 * Read data from a {@link stream} and transform its content into an {@link IpaOpenData} instance
 *
 * @param stream a stream reader of IPA Open Data (CSV formatted)
 * @returns an {@link IpaOpenData} instance
 */
export const createIpaDataReader = (
  ...[blobService, containerName, blobName, options]: Parameters<
    typeof getBlobAsText
  >
): IpaDataReader =>
  pipe(
    TE.tryCatch(
      () => getBlobAsText(blobService, containerName, blobName, options),
      err =>
        new Error(
          `Failed to read IPA from blob '${containerName}/${blobName}', error: ${E.toError(
            err
          )}`
        )
    ),
    TE.chain(TE.fromEither),
    TE.chain(
      TE.fromOption(
        () => new Error(`Blob '${containerName}/${blobName}' not found`)
      )
    ),
    TE.chain(stream =>
      TE.tryCatch(
        () => parseIpaData(stream),
        err =>
          new Error(
            `Failed to parse stream from '${containerName}/${blobName}', error: ${E.toError(
              err
            )}`
          )
      )
    )
  );

export type IpaDataReader = TE.TaskEither<Error, IpaOpenData>;

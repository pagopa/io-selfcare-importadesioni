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
export type MunicipalLandCode = string;
/**
 * An object representing organizations data retrieved from IPA
 */
export interface IIpaOpenData {
  readonly getFiscalCode: (key: IpaCode) => FiscalCode | undefined;
  readonly getIpaCode: (key: MunicipalLandCode) => IpaCode | undefined;
  readonly hasIpaCode: (key: IpaCode) => boolean;
  readonly hasMunicipalLandCode: (key: MunicipalLandCode) => boolean;
}

/**
 * Read data from a {@link string} and transform its content into an {@link IIpaOpenData} instance
 *
 * @param stream a row string of IPA Open Data (CSV formatted)
 * @returns an {@link IIpaOpenData} instance
 */
export const parseIpaData = async (data: string): Promise<IIpaOpenData> => {
  const ipaCode2FiscalCode = new Map<string, string>();
  const municipalLandCode2ipaCode = new Map<string, string>();
  const records: ReadonlyArray<ReadonlyArray<string>> = parse(data, {
    from_line: 2
  });
  records.forEach(row => {
    ipaCode2FiscalCode.set(row[1].toLowerCase(), row[3]);
    municipalLandCode2ipaCode.set(row[16].toLowerCase(), row[1].toLowerCase());
  });
  return {
    getFiscalCode: ipaCode2FiscalCode.get.bind(ipaCode2FiscalCode),
    getIpaCode: municipalLandCode2ipaCode.get.bind(municipalLandCode2ipaCode),
    hasIpaCode: ipaCode2FiscalCode.has.bind(ipaCode2FiscalCode),
    hasMunicipalLandCode: municipalLandCode2ipaCode.has.bind(
      municipalLandCode2ipaCode
    )
  };
};

/**
 * Read data from a {@link stream} and transform its content into an {@link IIpaOpenData} instance
 *
 * @param stream a stream reader of IPA Open Data (CSV formatted)
 * @returns an {@link IIpaOpenData} instance
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

export type IpaDataReader = TE.TaskEither<Error, IIpaOpenData>;

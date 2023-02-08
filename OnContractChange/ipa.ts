/**
 * Utility functions to read data from IPA Open Data (CSV formatted).
 */
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { parse } from "csv-parse";

export type IpaCode = string;
export type FiscalCode = string;
/**
 * A map representing organizations retrieved from IPA, with the IPA code as the key and the corresponding tax code as the value.
 */
export type IpaOpenData = ReadonlyMap<IpaCode, FiscalCode>;

/**
 * Read data from a {@link stream} and transform its content into an {@link IpaOpenData} instance
 *
 * @param stream a stream reader of IPA Open Data (CSV formatted)
 * @returns an {@link IpaOpenData} instance
 */
export const readIpaData = async (
  stream: NodeJS.ReadableStream
): Promise<IpaOpenData> => {
  const ipaCode2FiscalCode = new Map<string, string>();
  await pipeline(
    stream,
    parse({ delimiter: ",", from_line: 2 }),
    new Transform({
      flush: (callback): void => {
        callback(null, ipaCode2FiscalCode);
      },
      objectMode: true,
      transform: (row, _, callback): void => {
        try {
          ipaCode2FiscalCode.set(row[1], row[3]);
        } catch (e) {
          return callback(e as Error | null | undefined);
        }
        return callback();
      }
    })
  );
  return ipaCode2FiscalCode;
};

export type ReadIpaData = typeof readIpaData;

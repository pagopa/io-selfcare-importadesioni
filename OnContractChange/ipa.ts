/**
 * Utility functions to read data from IPA Open Data (CSV formatted).
 */
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { parse } from "csv-parse";

export type IpaCode = string;
export type FiscalCode = string | undefined;
export type IpaOpenData = ReadonlyMap<IpaCode, FiscalCode>;

export const readIpaData = async (
  stream: NodeJS.ReadableStream
): Promise<IpaOpenData> => {
  const ipaCode2FiscalCode = new Map<string, string | undefined>();
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

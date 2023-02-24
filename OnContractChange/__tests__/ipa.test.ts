import { parseIpaData } from "../ipa";
import { readFile } from "fs/promises";

describe("IPA utils", () => {
  it("should correctly read IPA Data from CSV file", async () => {
    const raw = await readFile("./OnContractChange/__tests__/ipa.csv", "utf-8");
    const res = await parseIpaData(raw);
    // check first CSV record
    expect(res.hasIpaCode("054".toLowerCase())).toBeTruthy();
    expect(res.hasFiscalCode("03301860544".toLowerCase())).toBeTruthy();
    expect(res.getFiscalCode("054".toLowerCase())).toEqual("03301860544");
    expect(res.getIpaCode("03301860544".toLowerCase())).toEqual(
      "054".toLowerCase()
    );
    // check last CSV record
    expect(res.hasIpaCode("0HD8JCF4".toLowerCase())).toBeTruthy();
    expect(res.hasFiscalCode("94314390488".toLowerCase())).toBeTruthy();
    expect(res.getFiscalCode("0HD8JCF4".toLowerCase())).toEqual("94314390488");
    expect(res.getIpaCode("94314390488".toLowerCase())).toEqual(
      "0HD8JCF4".toLowerCase()
    );
  });
});

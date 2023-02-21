import { parseIpaData } from "../ipa";
import { readFile } from "fs/promises";

describe("IPA utils", () => {
  it("should correctly read IPA Data from CSV file", async () => {
    const raw = await readFile("./OnContractChange/__tests__/ipa.csv", "utf-8");
    const res = await parseIpaData(raw);
    // check first CSV record
    expect(res.hasIpaCode("054".toLowerCase())).toBeTruthy;
    expect(res.hasMunicipalLandCode("G478".toLowerCase())).toBeTruthy;
    expect(res.getFiscalCode("03301860544")).toBeTruthy;
    expect(res.getIpaCode("054".toLowerCase())).toBeTruthy;
    // check last CSV record
    expect(res.hasIpaCode("0HD8JCF4".toLowerCase())).toBeTruthy;
    expect(res.hasMunicipalLandCode("D612".toLowerCase())).toBeTruthy;
    expect(res.getFiscalCode("94314390488")).toBeTruthy;
    expect(res.getIpaCode("0HD8JCF4".toLowerCase())).toBeTruthy;
  });
});

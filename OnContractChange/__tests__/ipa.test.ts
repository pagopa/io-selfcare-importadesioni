import { parseIpaData } from "../ipa";
import { readFile } from "fs/promises";

describe("IPA utils", () => {
  it("should correctly read IPA Data from CSV file", async () => {
    const raw = await readFile("./OnContractChange/__tests__/ipa.csv", "utf-8");
    const res = await parseIpaData(raw);
    expect(res.size).toBe(9);
  });
});

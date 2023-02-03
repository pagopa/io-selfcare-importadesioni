import { readIpaData } from "../ipa";
import { createReadStream } from "fs";

describe("IPA utils", () => {
  it("should correctly read IPA Data from CSV file", async () => {
    const stream = createReadStream("./OnContractChange/__tests__/ipa.csv");
    const res = await readIpaData(stream);
    expect(res.size).toBe(9);
  });
});

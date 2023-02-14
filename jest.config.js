module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testPathIgnorePatterns: ["dist", "/node_modules"],
  moduleNameMapper: {
    "^csv-parse/sync":
      "<rootDir>/node_modules/csv-parse/dist/cjs/sync.cjs"
  }
};

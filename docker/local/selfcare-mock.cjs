const { brotliCompressSync } = require("zlib");

module.exports = async context => {
  if (context.req?.params?.externalInstitutionId === "00000000001") {
    context.log.info("Local Brotli fixture; Accept-Encoding:", context.req.headers?.["accept-encoding"]);
    context.res = {
      status: 201,
      headers: { "Content-Type": "application/json", "Content-Encoding": "br" },
      body: brotliCompressSync(JSON.stringify({ fixture: "benign-brotli-response" })),
      isRaw: true
    };
    return;
  }
  return require("../../dist/SelfcareMock/index").default(context);
};
const express = require("express");
const storage = require("azure-storage");
const TE = require("fp-ts/lib/TaskEither");
const healthcheck = require("@pagopa/io-functions-commons/dist/src/utils/healthcheck");
const { secureExpressApp } = require("@pagopa/io-functions-commons/dist/src/utils/express");
const { setAppContext } = require("@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware");
const { wrapRequestHandler } = require("@pagopa/io-functions-commons/dist/src/utils/request_middleware");
const createAzureFunctionHandler = require("@pagopa/express-azure-functions/dist/src/createAzureFunctionsHandler").default;
const { InfoHandler } = require("../../dist/Info/handler");
const { IConfig } = require("../../dist/utils/config");

const checkLocalStorageHealth = config => TE.tryCatch(
  async () => {
    await Promise.all([
      storage.createBlobService,
      storage.createQueueService,
      storage.createTableService
    ].map(createService => new Promise((resolve, reject) => {
      createService(config.INTERNAL_STORAGE_CONNECTION_STRING).getServiceProperties(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    })));
    return true;
  },
  healthcheck.toHealthProblems("AzureStorage")
);

const app = express();
secureExpressApp(app);
app.get("/api/v1/info", wrapRequestHandler(InfoHandler(
  healthcheck.checkApplicationHealth(IConfig, [
    config => healthcheck.checkAzureCosmosDbHealth(config.COSMOSDB_URI, config.COSMOSDB_KEY),
    checkLocalStorageHealth
  ])
)));

const handler = createAzureFunctionHandler(app);
module.exports = context => {
  setAppContext(app, context);
  return handler(context);
};
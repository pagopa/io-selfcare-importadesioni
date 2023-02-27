import { AzureFunction } from "@azure/functions";

const httpStart: AzureFunction = async context => {
  const {
    executionContext: { functionName },
    req,
    log
  } = context;
  const externalInstitutionId = req?.params?.externalInstitutionId;

  if (!externalInstitutionId) {
    const detail = `${functionName} ERROR: externalInstitutionId not provided`;
    log.error(detail);
    return { body: { detail }, statusCode: 400 };
  }

  const trace = `${functionName} SUCCESS: request received for externalInstitutionId=${externalInstitutionId}`;
  log.info(trace);

  // eslint-disable-next-line functional/immutable-data
  context.res = { status: 201 };
};

export default httpStart;

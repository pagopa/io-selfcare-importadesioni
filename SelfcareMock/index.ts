import { AzureFunction } from "@azure/functions";

const httpStart: AzureFunction = async ({
  executionContext: { functionName },
  req,
  log
}) => {
  const externalInstitutionId = req?.params?.externalInstitutionId;

  if (!externalInstitutionId) {
    const detail = `${functionName} ERROR: externalInstitutionId not provided`;
    log.error(detail);
    return { body: { detail }, statusCode: 400 };
  }

  const trace = `${functionName} SUCCESS: request received for externalInstitutionId=${externalInstitutionId}`;
  log.info(trace);

  return { statusCode: 201 };
};

export default httpStart;

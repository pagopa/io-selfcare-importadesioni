import { Context } from "@azure/functions";

const handleContractChange = async (
  context: Context,
  documents: unknown
): Promise<unknown> => {
  context.log.info(`handleContractChange`, documents);
  return documents;
};

export default handleContractChange;

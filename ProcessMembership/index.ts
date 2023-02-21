import { cosmosdb } from "../utils/cosmosdb";

import { dao } from "../models/dao";

import { createClient } from "../utils/selfcare";
import { getConfigOrThrow } from "../utils/config";
import createHandler from "./handler";

const { SELFCARE_KEY, SELFCARE_URL } = getConfigOrThrow();

const selfcareClient = createClient(SELFCARE_URL.href, SELFCARE_KEY);

const handleContractChange = createHandler({
  dao: dao(cosmosdb),
  selfcareClient
});

export default handleContractChange;

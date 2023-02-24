import { cosmosdb } from "../utils/cosmosdb";

import { dao } from "../models/dao";

import createHandler from "./handler";

const handleContractChange = createHandler({
  dao: dao(cosmosdb)
});

export default handleContractChange;

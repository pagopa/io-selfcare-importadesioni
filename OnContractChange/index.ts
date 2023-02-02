import { cosmosdb } from "../utils/cosmosdb";
import { readIpaData } from "./ipa";
import { dao } from "./dao";
import OnContractChangeHandler from "./handler";

const handleContractChange = OnContractChangeHandler(
  dao(cosmosdb),
  readIpaData
);

export default handleContractChange;

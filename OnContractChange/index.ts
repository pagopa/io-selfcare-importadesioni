import { createBlobService } from "azure-storage";
import { cosmosdb } from "../utils/cosmosdb";
import { getConfigOrThrow } from "../utils/config";
import { createIpaDataReader } from "./ipa";
import { dao } from "../models/dao";
import OnContractChangeHandler from "./handler";

const config = getConfigOrThrow();

const blobService = createBlobService(
  config.INTERNAL_STORAGE_CONNECTION_STRING
);

const [containerName, ...rest] = config.IPA_OPEN_DATA_STORAGE_PATH.split("/");
const blobName = rest.join("/");

const handleContractChange = OnContractChangeHandler(
  dao(cosmosdb),
  createIpaDataReader(blobService, containerName, blobName)
);

export default handleContractChange;

import { createBlobService } from "@pagopa/azure-storage-legacy-migration-kit";
import { dao } from "../models/dao";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdb } from "../utils/cosmosdb";
import OnContractChangeHandler from "./handler";
import { createIpaDataReader } from "./ipa";

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

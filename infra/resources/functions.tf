#
# Variables
#
variable "functions_kind" {
  type        = string
  description = "App service plan kind"
  default     = null
}

variable "functions_sku_tier" {
  type        = string
  description = "App service plan sku tier"
  default     = null
}

variable "functions_sku_size" {
  type        = string
  description = "App service plan sku size"
  default     = null
}

variable "functions_autoscale_minimum" {
  type        = number
  description = "The minimum number of instances for this resource."
  default     = 1
}

variable "functions_autoscale_maximum" {
  type        = number
  description = "The maximum number of instances for this resource."
  default     = 30
}

variable "functions_autoscale_default" {
  type        = number
  description = "The number of instances that are available for scaling if metrics are not available for evaluation."
  default     = 1
}

#
# Function app definition
#

module "functions_app" {
  source = "git::https://github.com/pagopa/azurerm.git//function_app?ref=v3.4.0"

  resource_group_name = azurerm_resource_group.rg.name
  name                = format("%s-%s-fn", local.project, var.application_basename)
  location            = var.location
  health_check_path   = "/api/v1/info"

  os_type          = "linux"
  linux_fx_version = "NODE|16"
  runtime_version  = "~4"

  always_on = "true"

  app_service_plan_info = {
    kind                         = var.functions_kind
    sku_tier                     = var.functions_sku_tier
    sku_size                     = var.functions_sku_size
    maximum_elastic_worker_count = 0
  }

  app_settings = {
    FUNCTIONS_WORKER_RUNTIME       = "node"
    WEBSITE_NODE_DEFAULT_VERSION   = "16.9.1"
    WEBSITE_RUN_FROM_PACKAGE       = "1"
    WEBSITE_VNET_ROUTE_ALL         = "1"
    WEBSITE_DNS_SERVER             = "168.63.129.16"
    FUNCTIONS_WORKER_PROCESS_COUNT = "4"
    NODE_ENV                       = "production"

    // Keepalive fields are all optionals
    FETCH_KEEPALIVE_ENABLED             = "true"
    FETCH_KEEPALIVE_SOCKET_ACTIVE_TTL   = "110000"
    FETCH_KEEPALIVE_MAX_SOCKETS         = "40"
    FETCH_KEEPALIVE_MAX_FREE_SOCKETS    = "10"
    FETCH_KEEPALIVE_FREE_SOCKET_TIMEOUT = "30000"
    FETCH_KEEPALIVE_TIMEOUT             = "60000"

    # Source data
    COSMOSDB_CONNECTIONSTRING               = format("AccountEndpoint=%s;AccountKey=%s;", module.cosmosdb_account.endpoint, module.cosmosdb_account.primary_key),
    COSMOSDB_NAME                           = azurerm_cosmosdb_sql_database.db_importadesioni.name
    COSMOSDB_URI                            = module.cosmosdb_account.endpoint
    COSMOSDB_KEY                            = module.cosmosdb_account.primary_key
    COSMOSDB_PEC_CONTRACTS_COLLECTION       = "pecContratto"
    COSMOSDB_PEC_CONTRACTS_LEASE_COLLECTION = "pecContrattoLeases"
    IPA_OPEN_DATA_STORAGE_PATH              = "ipa/ipa-open-data.csv"
    AzureWebJobsStorage                     = module.storage_account.primary_connection_string

    # Selfcare connection
    SELFCARE_API_URL = "" # TBD
    SELFCARE_API_KEY = "" # TBD

    "AzureWebJobs.OnContractChange.Disabled" = var.env_short == "p" ? "1" : "0" # only enable prod for now
  }

  subnet_id = module.app_snet.id

  allowed_subnets = [module.app_snet.id]

  application_insights_instrumentation_key = "" # empty for now

  tags = var.tags
}

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
  source = "github.com/pagopa/terraform-azurerm-v3//function_app?ref=v8.28.0"

  resource_group_name = azurerm_resource_group.rg.name
  name                = format("%s-%s-fn", local.project, local.application_basename)
  location            = local.location
  health_check_path   = "/api/v1/info"

  node_version    = "16"
  runtime_version = "~4"

  always_on = "true"

  app_service_plan_info = {
    kind                         = local.functions_kind
    sku_tier                     = local.functions_sku_tier
    sku_size                     = local.functions_sku_size
    maximum_elastic_worker_count = 0
    worker_count                 = null
    zone_balancing_enabled       = false
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

    INTERNAL_STORAGE_CONNECTION_STRING = module.storage_account.primary_connection_string
    IPA_OPEN_DATA_STORAGE_PATH         = "ipa/ipa-open-data.csv"

    # Selfcare connection
    SELFCARE_URL = local.selfcare_url
    SELFCARE_KEY = "db57e16527c246bd8fee6b5a5a518a95"

    "AzureWebJobs.OnContractChange.Disabled" = "0"
  }

  subnet_id = module.app_snet.id

  allowed_subnets = [module.app_snet.id]

  application_insights_instrumentation_key = data.azurerm_application_insights.application_insights.instrumentation_key

  storage_account_info = {
    account_kind                      = "StorageV2"
    account_tier                      = "Standard"
    account_replication_type          = "ZRS"
    access_tier                       = "Hot"
    advanced_threat_protection_enable = true
    use_legacy_defender_version       = true
    public_network_access_enabled     = false
  }

  tags = local.tags
}

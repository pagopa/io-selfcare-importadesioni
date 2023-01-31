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
    COSMOSDB_NAME = azurerm_cosmosdb_sql_database.db_importadesioni.name
    COSMOSDB_URI  = module.cosmosdb_account.endpoint
    COSMOSDB_KEY  = module.cosmosdb_account.primary_key

    # Selfcare connection
    SELFCARE_API_URL = "" # TBD
    SELFCARE_API_KEY = "" # TBD
  }

  internal_storage = {
    "enable"                     = false# true,
    "private_endpoint_subnet_id" = "" # module.app_snet.id,
    "queues"                     = ["process-adesione", "process-adesione-poison"],
    "private_dns_zone_blob_ids"  = [],
    "private_dns_zone_queue_ids" = [],
    "private_dns_zone_table_ids" = [],
    "containers"                 = [],
    "blobs_retention_days"       = 0,
  }

  subnet_id = module.app_snet.id

  allowed_subnets = [module.app_snet.id]

  application_insights_instrumentation_key = "" # empty for now

  tags = var.tags
}

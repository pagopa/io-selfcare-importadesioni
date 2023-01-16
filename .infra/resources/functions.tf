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

locals {
  functions_app_settings_commons = {
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
    COSMOSDB_SOURCE_NAME = azurerm_cosmosdb_sql_database.db_importadesioni_source.name
    COSMOSDB_SOURCE_URI  = module.cosmosdb_account.endpoint
    COSMOSDB_SOURCE_KEY  = module.cosmosdb_account.primary_key
  }
}

module "functions_app" {
  source = "git::https://github.com/pagopa/azurerm.git//function_app?ref=v3.4.0"

  resource_group_name = azurerm_resource_group.rg.name
  name                = format("%s-%s-fn", var.application_basename, local.project)
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

  app_settings = merge(
    local.functions_app_settings_commons,
    {
      SLOT_NAME = "production"
      # Applicative db
      COSMOSDB_APP_NAME = azurerm_cosmosdb_sql_database.db_importadesioni.name
      COSMOSDB_APP_URI  = module.cosmosdb_account.endpoint
      COSMOSDB_APP_KEY  = module.cosmosdb_account.primary_key
    }
  )

  subnet_id = module.app_snet.id

  allowed_subnets = [
    data.azurerm_subnet.azdoa_snet.id,
  ]

  tags = var.tags
}


module "function_app_dryrun_slot" {
  source = "git::https://github.com/pagopa/azurerm.git//function_app_slot?ref=v3.4.0"

  name                = "dryrun"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  function_app_name   = module.function_app.name
  function_app_id     = module.function_app.id
  app_service_plan_id = module.function_app.app_service_plan_id
  health_check_path   = "/api/v1/info"

  storage_account_name               = module.function_app.storage_account.name
  storage_account_access_key         = module.function_app.storage_account.primary_access_key
  internal_storage_connection_string = module.function_app.storage_account_internal_function.primary_connection_string

  os_type          = "linux"
  linux_fx_version = "NODE|16"
  always_on        = "true"
  runtime_version  = "~4"


  app_settings = merge(
    local.functions_app_settings_commons,
    {
      SLOT_NAME = "dryrun"
      # Applicative db
      COSMOSDB_APP_NAME = azurerm_cosmosdb_sql_database.db_importadesioni_dryrun.name
      COSMOSDB_APP_URI  = module.cosmosdb_account.endpoint
      COSMOSDB_APP_KEY  = module.cosmosdb_account.primary_key
    }
  )

  subnet_id = module.app_snet.id

  allowed_subnets = [
    data.azurerm_subnet.azdoa_snet.id,
  ]

  tags = var.tags
}

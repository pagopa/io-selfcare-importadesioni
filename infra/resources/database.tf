# Database instance

variable "cosmos_private_endpoint_enabled" {
  type = bool
}

variable "cosmos_public_network_access_enabled" {
  type = bool
}

module "cosmosdb_account" {
  source = "git::https://github.com/pagopa/azurerm.git//cosmosdb_account?ref=v4.3.2"

  name                = format("%s-cosmos-%s", local.project, var.application_basename)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  enable_free_tier    = false
  kind                = "GlobalDocumentDB"
  domain              = "SELFCARE"

  public_network_access_enabled     = var.cosmos_public_network_access_enabled
  private_endpoint_enabled          = var.cosmos_private_endpoint_enabled
  private_dns_zone_ids              = var.env_short == "p" ? [data.azurerm_private_dns_zone.privatelink_documents_azure_com[0].id] : []
  subnet_id                         = var.env_short == "p" ? data.azurerm_subnet.private_endpoints_subnet[0].id : null
  is_virtual_network_filter_enabled = false

  main_geo_location_location       = azurerm_resource_group.rg.location
  main_geo_location_zone_redundant = false
  consistency_policy = {
    consistency_level       = "Session"
    max_interval_in_seconds = null
    max_staleness_prefix    = null
  }

  capabilities = [
    "EnableServerless"
  ]

  tags = var.tags
}

resource "azurerm_cosmosdb_sql_database" "db_importadesioni" {
  name                = "importadesioni"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = module.cosmosdb_account.name
}

### Containers
locals {
  database_containers = [
    {
      name               = "Contratto"
      partition_key_path = "/ID"
    },
    {
      name               = "Allegato"
      partition_key_path = "/ID"
    },
    {
      name               = "Delegato"
      partition_key_path = "/ID"
    },
    {
      name               = "SoggettoAggregato"
      partition_key_path = "/ID"
    },
  ]
}

module "db_importadesioni_containers" {
  source   = "git::https://github.com/pagopa/azurerm.git//cosmosdb_sql_container?ref=v2.15.1"
  for_each = { for c in local.database_containers : c.name => c }

  name                = each.value.name
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = module.cosmosdb_account.name
  database_name       = azurerm_cosmosdb_sql_database.db_importadesioni.name
  partition_key_path  = each.value.partition_key_path
}

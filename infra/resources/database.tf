# Database instance
module "cosmosdb_account" {
  source = "git::https://github.com/pagopa/azurerm.git//cosmosdb_account?ref=v2.15.1"

  name                = format("%s-cosmos-%s", local.project, var.application_basename)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  enable_free_tier    = false
  kind                = "GlobalDocumentDB"

  public_network_access_enabled     = false
  private_endpoint_enabled          = false
  subnet_id                         = module.app_snet.id
  is_virtual_network_filter_enabled = false

  main_geo_location_location       = azurerm_resource_group.rg.location
  main_geo_location_zone_redundant = false
  consistency_policy = {
    consistency_level       = "Session"
    max_interval_in_seconds = null
    max_staleness_prefix    = null
  }

  tags = var.tags
}

resource "azurerm_cosmosdb_sql_database" "db_importadesioni" {
  name                = "importadesioni"
  resource_group_name = azurerm_resource_group.rg.name
  account_name        = module.cosmosdb_account.name

  autoscale_settings {
    max_throughput = 4000
  }
}

### Containers
locals {
  database_containers = [
    {
      name               = "Contratto"
      partition_key_path = "/ID"
      autoscale_settings = {
        max_throughput = 4000
      }
    },
    {
      name               = "Allegato"
      partition_key_path = "/ID"
      autoscale_settings = {
        max_throughput = 4000
      }
    },
    {
      name               = "Delegato"
      partition_key_path = "/ID"
      autoscale_settings = {
        max_throughput = 4000
      }
    },
    {
      name               = "SoggettoAggregato"
      partition_key_path = "/ID"
      autoscale_settings = {
        max_throughput = 4000
      }
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
  throughput          = lookup(each.value, "throughput", null)

  autoscale_settings = lookup(each.value, "autoscale_settings", null)

}

# Database instance
module "cosmosdb_account" {
  source = "git::https://github.com/pagopa/azurerm.git//cosmosdb_account?ref=v2.15.1"

  name                = format("%s-cosmos-%s", var.application_basename, local.project)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  enable_free_tier    = false
  kind                = "SQL"

  public_network_access_enabled     = false
  private_endpoint_enabled          = true
  subnet_id                         = data.azurerm_subnet.private_endpoints_subnet.id
  private_dns_zone_ids              = [data.azurerm_private_dns_zone.privatelink_mongo_cosmos_azure_com.id]
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
    max_throughput = 1000
  }
}

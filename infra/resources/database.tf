module "cosmosdb_account" {
  source = "github.com/pagopa/terraform-azurerm-v3//cosmosdb_account?ref=v8.28.0"

  name                = format("%s-cosmos-%s", local.project, local.application_basename)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  enable_free_tier    = false
  kind                = "GlobalDocumentDB"
  domain              = "SELFCARE"

  public_network_access_enabled     = local.cosmos_public_network_access_enabled
  private_endpoint_enabled          = local.cosmos_private_endpoint_enabled
  subnet_id                         = local.env_short == "p" ? data.azurerm_subnet.private_endpoints_subnet[0].id : null
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

  enable_provisioned_throughput_exceeded_alert = false

  tags = local.tags
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
      name               = "pecEmail"
      partition_key_path = "/id"
    },
    {
      name               = "pecContratto"
      partition_key_path = "/id"
    },
    {
      name               = "pecAllegato"
      partition_key_path = "/id"
    },
    {
      name               = "pecDelegato"
      partition_key_path = "/IDALLEGATO"
    },
    {
      name               = "pecSoggettoAggregato"
      partition_key_path = "/IDALLEGATO"
    },
    {
      name               = "memberships"
      partition_key_path = "/ipaCode"
    },
    {
      name               = "contracts"
      partition_key_path = "/ipaCode"
    }
  ]
}

resource "azurerm_cosmosdb_sql_container" "db_importadesioni_containers" {
  for_each = { for c in local.database_containers : c.name => c }

  name                  = each.value.name
  resource_group_name   = azurerm_resource_group.rg.name
  account_name          = module.cosmosdb_account.name
  database_name         = azurerm_cosmosdb_sql_database.db_importadesioni.name
  partition_key_path    = each.value.partition_key_path
  partition_key_version = each.value.name == "memberships" ? null : 2
}

resource "azurerm_role_assignment" "role_assignment_cosmos_user_access_admin_ad" {
  scope                = module.cosmosdb_account.id
  role_definition_name = "User Access Administrator"
  principal_id         = data.azuread_group.ad_group_services_cms.object_id
}

#
# External dependency
#

data "azuread_group" "ad_group_services_cms" {
  display_name = "${local.project}-adgroup-services-cms"
}

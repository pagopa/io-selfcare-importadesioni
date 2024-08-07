#
# External dependency
#

data "azurerm_resource_group" "vnet_common_rg" {
  name = local.vnet_common_rg
}

data "azurerm_virtual_network" "vnet_common" {
  name                = local.vnet_name
  resource_group_name = data.azurerm_resource_group.vnet_common_rg.name
}

data "azurerm_subnet" "private_endpoints_subnet" {
  count = local.env_short == "p" ? 1 : 0

  name                 = "pendpoints"
  virtual_network_name = local.vnet_name
  resource_group_name  = local.vnet_common_rg
}

data "azurerm_private_dns_zone" "privatelink_documents_azure_com" {
  count = local.env_short == "p" ? 1 : 0

  name                = "privatelink.documents.azure.com"
  resource_group_name = local.vnet_common_rg
}

#
# SNET definition
#

module "app_snet" {
  source               = "github.com/pagopa/terraform-azurerm-v3//subnet?ref=v8.28.0"
  name                 = format("%s-%s-snet", local.project, local.application_basename)
  address_prefixes     = [local.cidr_subnet]
  resource_group_name  = data.azurerm_resource_group.vnet_common_rg.name
  virtual_network_name = data.azurerm_virtual_network.vnet_common.name
  # enforce_private_link_endpoint_network_policies = true

  service_endpoints = [
    "Microsoft.Web",
    "Microsoft.AzureCosmosDB",
    "Microsoft.Storage",
  ]

  delegation = {
    name = "default"
    service_delegation = {
      name    = "Microsoft.Web/serverFarms"
      actions = ["Microsoft.Network/virtualNetworks/subnets/action"]
    }
  }
}

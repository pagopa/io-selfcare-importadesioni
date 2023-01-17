#
# Variables
#

variable "vnet_common_rg" {
  type        = string
  description = "Common Virtual network resource group name."
  default     = ""
}

variable "vnet_name" {
  type        = string
  description = "Common Virtual network resource name."
  default     = ""
}

variable "cidr_subnet" {
  type        = list(string)
  description = "Subnet address space."
}

#
# External dependency
#

data "azurerm_resource_group" "vnet_common_rg" {
  name = var.vnet_common_rg
}

data "azurerm_virtual_network" "vnet_common" {
  name                = var.vnet_name
  resource_group_name = data.azurerm_resource_group.vnet_common_rg.name
}

data "azurerm_subnet" "azdoa_snet" {
  name                 = "azure-devops"
  virtual_network_name = data.azurerm_virtual_network.vnet_common.name
  resource_group_name  = data.azurerm_resource_group.vnet_common_rg.name
}

#
# SNET definition
#

module "app_snet" {
  source                                         = "git::https://github.com/pagopa/azurerm.git//subnet?ref=v1.0.51"
  name                                           = format("%s-%s-snet-%d", var.application_basename, local.project)
  address_prefixes                               = [var.cidr_subnet]
  resource_group_name                            = data.azurerm_resource_group.vnet_common_rg.name
  virtual_network_name                           = data.azurerm_virtual_network.vnet_common.name
  enforce_private_link_endpoint_network_policies = true

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

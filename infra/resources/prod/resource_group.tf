resource "azurerm_resource_group" "rg" {
  name     = format("%s-selfcare-importadesioni-rg", local.project)
  location = local.location

  tags = local.tags
}

resource "azurerm_resource_group" "itn" {
  name     = format("%s-importadesioni-rg-01", local.project_itn)
  location = local.location_itn

  tags = local.tags
}

resource "azurerm_role_assignment" "devs_group_rg_es" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Owner"
  principal_id         = data.azuread_group.svc_devs.object_id
  description          = "Allow ES Dev group to manage resource group"
}

resource "azurerm_role_assignment" "devs_group_rg_es_itn" {
  scope                = azurerm_resource_group.itn.id
  role_definition_name = "Owner"
  principal_id         = data.azuread_group.svc_devs.object_id
  description          = "Allow ES Dev group to manage resource group"
}

#
# External dependency
#

data "azuread_group" "svc_devs" {
  display_name = "${local.project}-adgroup-svc-developers"
}
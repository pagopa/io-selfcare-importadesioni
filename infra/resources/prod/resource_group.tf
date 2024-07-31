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

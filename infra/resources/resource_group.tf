resource "azurerm_resource_group" "rg" {
  name     = format("%s-selfcare-importadesioni-rg", local.project)
  location = local.location

  tags = local.tags
}

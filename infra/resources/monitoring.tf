# Application insights
resource "azurerm_application_insights" "application_insights" {
  name                = format("%s-%s-appinsights", local.project, var.application_basename)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  application_type    = "Node.JS"

  tags = var.tags
}

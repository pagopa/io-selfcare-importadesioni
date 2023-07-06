data "azurerm_application_insights" "application_insights" {
  name                = format("%s-%s-fn", local.project, var.application_basename)
  resource_group_name = azurerm_resource_group.rg.name
}

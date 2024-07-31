# Application insights

variable "application_insights_name" {
  type        = string
  description = "Application Insight instance name"
  default     = null
}
variable "application_insights_rg_name" {
  type        = string
  description = "Application Insight resource group name"
  default     = null
}

data "azurerm_application_insights" "application_insights" {
  name                = local.application_insights_name
  resource_group_name = local.application_insights_rg_name
}

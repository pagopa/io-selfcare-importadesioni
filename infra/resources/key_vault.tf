variable "key_vault_name" {
  type        = string
  description = "Key Vault instance name"
  default     = null
}
variable "key_vault_rg_name" {
  type        = string
  description = "Key Vault resource group name"
  default     = null
}


module "key_vault" {
  count = local.is_prod ? 0 : 1

  source = "git::https://github.com/pagopa/azurerm.git//key_vault?ref=v3.4.0"

  name                       = "${local.project}-${var.application_basename}-kv"
  location                   = azurerm_resource_group.rg.location
  resource_group_name        = azurerm_resource_group.rg.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  soft_delete_retention_days = 90
  sku_name                   = "standard"

  lock_enable = false

  tags = var.tags
}

data "azurerm_key_vault" "key_vault" {
  count = local.is_prod ? 1 : 0

  name                = var.key_vault_name
  resource_group_name = var.key_vault_rg_name
}

data "azurerm_key_vault_secret" "selfcare_apikey" {
  name         = "${var.application_basename}-SELFCARE-APIKEY"
  key_vault_id = local.is_prod ? data.azurerm_key_vault.key_vault[0].id : module.key_vault[0].id
}

module "storage_account" {
  source = "github.com/pagopa/terraform-azurerm-v3//storage_account?ref=v8.28.0"

  name                          = replace(format("%s-%s-st", local.project, local.application_basename), "-", "")
  account_kind                  = "StorageV2"
  account_tier                  = "Standard"
  account_replication_type      = "ZRS"
  access_tier                   = "Hot"
  public_network_access_enabled = true
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = local.location
  advanced_threat_protection    = false
  enable_low_availability_alert = false

  tags = local.tags
}

resource "azurerm_storage_queue" "process_membership" {
  name                 = "process-membership"
  storage_account_name = module.storage_account.name
}

resource "azurerm_storage_queue" "process_membership_poison" {
  name                 = "process-membership-poison"
  storage_account_name = module.storage_account.name
}

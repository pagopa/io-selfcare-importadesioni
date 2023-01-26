module "storage_account" {
  source = "git::https://github.com/pagopa/azurerm.git//storage_account?ref=v2.5.2"

  name                       = replace(format("%s-%s-st", local.project, var.application_basename), "-", "")
  account_kind               = "StorageV2"
  account_tier               = "Standard"
  account_replication_type   = "ZRS"
  access_tier                = "Hot"
  versioning_name            = "versioning"
  enable_versioning          = false
  resource_group_name        = azurerm_resource_group.rg.name
  location                   = var.location
  advanced_threat_protection = false
  allow_blob_public_access   = false

  tags = var.tags
}

# https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs/resources/storage_queue
resource "azurerm_storage_queue" "process-adesione" {
  name                 = "process-adesione"
  storage_account_name = module.storage_account.name
}

resource "azurerm_storage_queue" "process-adesione-poison" {
  name                 = "process-adesione-poison"
  storage_account_name = module.storage_account.name
}

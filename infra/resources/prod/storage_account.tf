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

  blob_versioning_enabled = true

  tags = local.tags
}

module "storage_account_itn" {
  source = "github.com/pagopa/terraform-azurerm-v3//storage_account?ref=v8.28.0"

  name                          = "${replace(local.project_itn, "-", "")}${local.application_basename}st01"
  account_kind                  = "StorageV2"
  account_tier                  = "Standard"
  account_replication_type      = "ZRS"
  access_tier                   = "Hot"
  public_network_access_enabled = true
  resource_group_name           = azurerm_resource_group.itn.name
  location                      = local.location_itn
  advanced_threat_protection    = false
  enable_low_availability_alert = false

  tags = local.tags
}

resource "azurerm_storage_container" "ipa" {
  name                  = "ipa"
  storage_account_name  = module.storage_account.name
  container_access_type = "private"
}

resource "azurerm_storage_container" "ipa_itn" {
  name                  = "ipa"
  storage_account_name  = module.storage_account_itn.name
  container_access_type = "private"
}

resource "azurerm_storage_queue" "process_membership" {
  name                 = "process-membership"
  storage_account_name = module.storage_account.name
}

resource "azurerm_storage_queue" "process_membership_poison" {
  name                 = "process-membership-poison"
  storage_account_name = module.storage_account.name
}

resource "azurerm_storage_queue" "process_membership_itn" {
  name                 = "process-membership"
  storage_account_name = module.storage_account_itn.name
}

resource "azurerm_storage_queue" "process_membership_poison_itn" {
  name                 = "process-membership-poison"
  storage_account_name = module.storage_account_itn.name
}

resource "azurerm_storage_object_replication" "weu_itn" {
  source_storage_account_id      = module.storage_account.id
  destination_storage_account_id = module.storage_account_itn.id

  rules {
    source_container_name      = azurerm_storage_container.ipa.name
    destination_container_name = azurerm_storage_container.ipa_itn.name
    copy_blobs_created_after   = "Everything"
  }
}

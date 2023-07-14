env       = "prod"
env_short = "p"

tags = {
  CreatedBy   = "Terraform"
  Environment = "Prod"
  Owner       = "IO"
  Source      = "https://github.com/pagopa/io-selfcare-importadesioni"
  CostCenter  = "TS310 - PAGAMENTI & SERVIZI"
}

## Selfcare
selfcare_url = "https://api.selfcare.pagopa.it/external/onboarding-io/v1"

## Network
vnet_common_rg = "io-p-rg-common"
vnet_name      = "io-p-vnet-common"
cidr_subnet    = "10.0.134.0/26"

## Functions
functions_kind              = "Linux"
functions_sku_tier          = "Standard"
functions_sku_size          = "S1"
functions_autoscale_minimum = 1
functions_autoscale_maximum = 3
functions_autoscale_default = 1

cosmos_private_endpoint_enabled      = true
cosmos_public_network_access_enabled = false

# Monitoring
application_insights_name    = "io-p-ai-common"
application_insights_rg_name = "io-p-rg-common"

# Key Vault
key_vault_name    = "io-p-kv-common"
key_vault_rg_name = "io-p-rg-common"

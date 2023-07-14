env       = "dev"
env_short = "d"

tags = {
  CreatedBy   = "Terraform"
  Environment = "Dev"
  Owner       = "IO"
  Source      = "https://github.com/pagopa/io-selfcare-importadesioni"
  CostCenter  = "TS310 - PAGAMENTI & SERVIZI"
}

## Selfcare
selfcare_url = "https://api.uat.selfcare.pagopa.it/external/onboarding-io/v1"

## Network
vnet_common_rg = "io-d-rg-common"
vnet_name      = "io-d-vnet-common"
cidr_subnet    = "10.1.1.0/24"

## Functions
functions_kind              = "Linux"
functions_sku_tier          = "Standard"
functions_sku_size          = "S1"
functions_autoscale_minimum = 1
functions_autoscale_maximum = 3
functions_autoscale_default = 1

cosmos_private_endpoint_enabled      = false
cosmos_public_network_access_enabled = true

# Monitoring
application_insights_name    = "io-d-ai-common"
application_insights_rg_name = "io-d-rg-common"

# Key Vault
key_vault_name    = "io-d-importadesioni-kv"
key_vault_rg_name = "io-d-selfcare-importadesioni-rg"

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
selfcare_url = "https://io-d-importadesioni-fn.azurewebsites.net/api/v1"

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

cosmos_private_endpoint_enabled = false
cosmos_public_network_access_enabled = true
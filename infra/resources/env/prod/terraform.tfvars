env       = "prod"
env_short = "p"

tags = {
  CreatedBy   = "Terraform"
  Environment = "Prod"
  Owner       = "IO"
  Source      = "https://github.com/pagopa/io-selfcare-importadesioni"
  CostCenter  = "TS310 - PAGAMENTI & SERVIZI"
}

## Network
vnet_common_rg = "io-p-rg-common"
vnet_name      = "io-p-vnet-common"
cidr_subnet    = ["10.0.0.0/24"]

## Functions
functions_kind              = "Linux"
functions_sku_tier          = "Standard"
functions_sku_size          = "S1"
functions_autoscale_minimum = 1
functions_autoscale_maximum = 3
functions_autoscale_default = 1

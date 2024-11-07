locals {
  prefix               = "io"
  env                  = "prod"
  env_short            = "p"
  location             = "westeurope"
  location_itn         = "italynorth"
  app_name             = "ex"
  project_itn          = "${local.prefix}-${local.env_short}-itn"
  project              = "${local.prefix}-${local.env_short}"
  application_basename = "importadesioni"

  selfcare_url = "https://api.selfcare.pagopa.it/external/onboarding-io/v1"

  vnet_common_rg = "io-p-rg-common"
  vnet_name      = "io-p-vnet-common"
  cidr_subnet    = "10.0.134.0/26"

  functions_kind              = "Linux"
  functions_sku_tier          = "Standard"
  functions_sku_size          = "S1"
  functions_autoscale_minimum = 1
  functions_autoscale_maximum = 3
  functions_autoscale_default = 1

  cosmos_private_endpoint_enabled      = true
  cosmos_public_network_access_enabled = false

  application_insights_name    = "io-p-ai-common"
  application_insights_rg_name = "io-p-rg-common"

  tags = {
    CreatedBy      = "Terraform"
    Environment    = "Prod"
    Owner          = "IO"
    Source         = "https://github.com/pagopa/io-selfcare-importadesioni"
    CostCenter     = "TS310 - PAGAMENTI & SERVIZI"
    ManagementTeam = "IO Enti & Servizi"
  }
  domain          = "importadesioni"
  instance_number = "01"
  itn_environment = {
    prefix          = local.prefix
    env_short       = local.env_short
    location        = local.location_itn
    app_name        = local.app_name
    domain          = local.domain
    instance_number = local.instance_number
  }
}

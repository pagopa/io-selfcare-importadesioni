terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "<= 3.112.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "= 2.16.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "tfappprodio"
    container_name       = "terraform-state"
    key                  = "io-selfcare-importadesioni.terraform.tfstate"
  }
}

provider "azurerm" {
  features {}
}

data "azurerm_subscription" "current" {}

data "azurerm_client_config" "current" {}

module "common_values" {
  source = "github.com/pagopa/io-infra//src/_modules/common_values?ref=main"
}

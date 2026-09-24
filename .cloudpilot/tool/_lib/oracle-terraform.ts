// Generates OpenTofu/Terraform config for an Oracle Cloud "Always Free"
// compute instance + minimal networking. Uses data sources for the
// availability domain and OS image instead of hardcoding OCIDs (those
// differ per region/tenancy), so the same template works anywhere.
//
// Free tier shapes: VM.Standard.E2.1.Micro (AMD, x86) or
// VM.Standard.A1.Flex (ARM, up to 4 OCPU / 24GB across all A1 instances).
// We default to the AMD micro shape since it needs no OCPU/memory flags
// and is the least likely to hit capacity limits.

export interface TerraformInput {
  deploymentId: string
  compartmentId: string
  appPort: number
  appLabel: string
  sshPublicKey: string
  shape?: "VM.Standard.E2.1.Micro" | "VM.Standard.A1.Flex"
}

export function renderMainTf(input: TerraformInput): string {
  const shape = input.shape ?? "VM.Standard.E2.1.Micro"
  const isFlex = shape === "VM.Standard.A1.Flex"

  return `terraform {
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }
}

variable "compartment_id" {
  type    = string
  default = "${input.compartmentId}"
}

variable "app_port" {
  type    = number
  default = ${input.appPort}
}

variable "ssh_public_key" {
  type    = string
  default = <<-EOT
  ${input.sshPublicKey.trim()}
  EOT
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_id
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "${shape}"
  sort_by                  = "TIMECREATED"
  sort_order                = "DESC"
}

resource "oci_core_vcn" "deploy_vcn" {
  compartment_id = var.compartment_id
  cidr_block     = "10.20.0.0/16"
  display_name   = "cloudpilot-deploy-${input.deploymentId}"
  dns_label      = "cpdeploy"
}

resource "oci_core_internet_gateway" "deploy_igw" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.deploy_vcn.id
  display_name   = "cloudpilot-igw-${input.deploymentId}"
  enabled        = true
}

resource "oci_core_route_table" "deploy_rt" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.deploy_vcn.id
  display_name   = "cloudpilot-rt-${input.deploymentId}"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.deploy_igw.id
  }
}

resource "oci_core_security_list" "deploy_sl" {
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.deploy_vcn.id
  display_name   = "cloudpilot-sl-${input.deploymentId}"

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol = "6" # TCP
    source   = "0.0.0.0/0"
    tcp_options {
      min = var.app_port
      max = var.app_port
    }
  }
}

resource "oci_core_subnet" "deploy_subnet" {
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.deploy_vcn.id
  cidr_block                 = "10.20.1.0/24"
  display_name               = "cloudpilot-subnet-${input.deploymentId}"
  dns_label                  = "cpsubnet"
  route_table_id             = oci_core_route_table.deploy_rt.id
  security_list_ids          = [oci_core_security_list.deploy_sl.id]
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_instance" "deploy_instance" {
  compartment_id      = var.compartment_id
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  display_name        = "cloudpilot-${input.appLabel}-${input.deploymentId}"
  shape                = "${shape}"

${
  isFlex
    ? `  shape_config {
    ocpus         = 1
    memory_in_gbs = 6
  }
`
    : ""
}
  create_vnic_details {
    subnet_id        = oci_core_subnet.deploy_subnet.id
    assign_public_ip = true
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu.images[0].id
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
  }
}

output "public_ip" {
  value = oci_core_instance.deploy_instance.public_ip
}

output "instance_ocid" {
  value = oci_core_instance.deploy_instance.id
}
`
}

export function renderProviderTf(): string {
  // Deliberately left generic: OCI provider auth is picked up from the
  // standard `~/.oci/config` file (the same one `oci setup config`
  // writes), or from OCI_CLI_* / TF_VAR_* env vars if the user prefers
  // that. Nothing here ever contains a credential.
  return `provider "oci" {
  # Auth is read from ~/.oci/config (see \`oci setup config\`) or from the
  # standard OCI_CLI_* environment variables. No credentials are stored
  # in this repository or in Terraform state variables.
}
`
}

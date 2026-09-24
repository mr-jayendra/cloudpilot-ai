/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { promises as fs } from "node:fs"
import path from "node:path"
import { commandExists, run } from "./_lib/exec"
import { renderMainTf, renderProviderTf } from "./_lib/oracle-terraform"
import { PROVIDERS } from "./_lib/providers"
import { log, loadState, recordResource, saveState, setStep } from "./_lib/state"

async function findTerraformBinary(): Promise<string | undefined> {
  if (await commandExists("tofu")) return "tofu"
  if (await commandExists("terraform")) return "terraform"
  return undefined
}

export default tool({
  description: `HIGH IMPACT: provisions real cloud infrastructure for an approved deployment plan. For provider "oracle" it creates a VCN, subnet, security list, and compute instance via OpenTofu/Terraform. For aws/gcp/azure it does NOT run Terraform -- instead it returns the exact MCP/CLI steps the agent must run through the connected MCP server, after the same explicit approval checkpoint.

Requires an approved plan from deploy-plan or deploy-requirements (pass its deploymentId). This tool ALWAYS asks for explicit approval showing the exact resources that will be created before running anything. It never fabricates success: if the CLI is missing, auth fails, or apply fails, it reports the real error and does not mark the deployment as provisioned.`,
  args: {
    deployment_id: tool.schema.string().describe("The deploymentId returned by deploy-plan"),
  },
  async execute(args, ctx) {
    const state = await loadState(ctx.directory, args.deployment_id)
    if (!state) {
      return { title: "No such deployment", output: `No deployment found with id ${args.deployment_id}. Run deploy-plan first.` }
    }
    const connection = await PROVIDERS[state.provider].status(ctx.directory)
    if (!connection.connected) {
      return {
        title: `${connection.name} not connected`,
        output: `✗ ${connection.name} is NOT connected -- ${connection.detail}\n\nNotify the user exactly what is missing and stop. Run deploy-connect first; do not proceed until the provider is connected.`,
      }
    }
    if (state.provider !== "oracle") {
      await ctx.ask({
        permission: "deploy_provision",
        patterns: [state.deploymentId],
        always: [],
        metadata: {
          summary: `About to provision ${state.provider} infrastructure for deployment ${state.deploymentId} via the connected MCP server / ${state.provider} CLI (region: ${state.region ?? "default"}). The agent will run the provider create-network + create-VM steps through MCP after this approval.`,
        },
      })
      setStep(state, "provision", "waiting_for_approval")
      log(state, `Provisioning approved for ${state.provider} -- agent continues via MCP/CLI`)
      await saveState(ctx.directory, state)
      return {
        title: `Provision via MCP: ${state.provider}`,
        output: [
          `Provisioning for "${state.provider}" is approved for deployment ${state.deploymentId}.`,
          "",
          "The agent must now carry out the rest via the connected MCP server / provider CLI (do NOT simulate):",
          `- Network: create VPC/VNet opening ports 22 and ${state.appPort ?? 8080}`,
          `- Compute: create a Free Tier eligible VM (Ubuntu 22.04 or equivalent) in ${state.region ?? "the chosen region"}`,
          "- Record the public IP + SSH access back into the deployment (deploy-app needs instance.publicIp + sshKeyPath),",
          "- then continue with deploy-app + deploy-status.",
          "",
          "If no MCP server is configured for this provider, authenticate its CLI first (see deploy-providers) and run the same steps through the CLI.",
        ].join("\n"),
        metadata: { deploymentId: state.deploymentId, provider: state.provider, via: "mcp" },
      }
    }
    if (!state.plan) {
      return { title: "No approved plan", output: "This deployment has no approved plan yet. Run deploy-requirements then deploy-plan first." }
    }

    const tf = await findTerraformBinary()
    if (!tf) {
      log(state, "Provisioning aborted: no Terraform/OpenTofu binary found")
      await saveState(ctx.directory, state)
      return {
        title: "OpenTofu/Terraform not installed",
        output: "Neither `tofu` nor `terraform` is on PATH. Install OpenTofu (https://opentofu.org/docs/intro/install/) and try again. Nothing was created.",
      }
    }

    const keyDir = path.join(ctx.directory, ".cloudpilot", "deploy", "keys")
    const pubKeyPath = path.join(keyDir, "deploy_id_ed25519.pub")
    const privKeyPath = path.join(keyDir, "deploy_id_ed25519")
    let sshPublicKey: string
    try {
      sshPublicKey = (await fs.readFile(pubKeyPath, "utf8")).trim()
    } catch {
      await fs.mkdir(keyDir, { recursive: true })
      const gen = await run("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privKeyPath, "-C", "cloudpilot-deploy"])
      if (!gen.ok) {
        return {
          title: "No deployment SSH key",
          output: `No SSH key found at ${pubKeyPath} and generating one failed: ${gen.stderr || gen.stdout}. Nothing was created.`,
        }
      }
      sshPublicKey = (await fs.readFile(pubKeyPath, "utf8")).trim()
    }

    const tfDir = path.join(ctx.directory, ".cloudpilot", "deploy", "terraform", state.deploymentId)
    await fs.mkdir(tfDir, { recursive: true })

    const appPort = state.appPort ?? 8080
    const mainTf = renderMainTf({
      deploymentId: state.deploymentId,
      compartmentId: state.compartmentId ?? "",
      appPort,
      appLabel: state.appType ?? "app",
      sshPublicKey,
    })
    await fs.writeFile(path.join(tfDir, "main.tf"), mainTf, "utf8")
    await fs.writeFile(path.join(tfDir, "provider.tf"), renderProviderTf(), "utf8")

    const resourceList = [
      "- 1x VCN (10.20.0.0/16)",
      "- 1x subnet, internet gateway, route table",
      `- 1x security list allowing inbound TCP 22 (SSH) and ${appPort} (app)`,
      "- 1x VM.Standard.E2.1.Micro compute instance (Oracle Free Tier eligible), Canonical Ubuntu 22.04, with a public IP",
    ]

    await ctx.ask({
      permission: "deploy_provision",
      patterns: [state.deploymentId],
      always: [],
      metadata: {
        summary: `About to create the following Oracle Cloud resources for deployment ${state.deploymentId}:\n${resourceList.join("\n")}\n\nRegion: ${state.region}\nCompartment: ${state.compartmentId}`,
      },
    })

    setStep(state, "provision", "running")
    state.status = "provisioning"
    log(state, `Approved -- running ${tf} init/apply in ${tfDir}`)
    await saveState(ctx.directory, state)

    ctx.metadata({ title: `Running ${tf} init` })
    const init = await run(tf, ["init", "-input=false"], { cwd: tfDir, timeoutMs: 180_000, onOutput: (chunk) => ctx.metadata({ title: `${tf} init`, metadata: { chunk } }) })
    if (!init.ok) {
      setStep(state, "provision", "failed", init.stderr || init.stdout)
      state.status = "failed"
      state.errors.push(`terraform init failed: ${init.stderr || init.stdout}`)
      await saveState(ctx.directory, state)
      return { title: "Provisioning failed (init)", output: `\`${tf} init\` failed:\n\n${init.stderr || init.stdout}` }
    }

    ctx.metadata({ title: `Running ${tf} apply` })
    const apply = await run(tf, ["apply", "-auto-approve", "-input=false"], {
      cwd: tfDir,
      timeoutMs: 600_000,
      onOutput: (chunk) => ctx.metadata({ title: `${tf} apply`, metadata: { chunk } }),
    })
    if (!apply.ok) {
      setStep(state, "provision", "failed", apply.stderr || apply.stdout)
      state.status = "failed"
      state.errors.push(`terraform apply failed: ${apply.stderr || apply.stdout}`)
      await saveState(ctx.directory, state)
      return {
        title: "Provisioning failed (apply)",
        output: `\`${tf} apply\` failed:\n\n${apply.stderr || apply.stdout}\n\nNo partial success is assumed -- check \`${tf} state list\` in ${tfDir} to see what (if anything) exists, and consider deploy-rollback to destroy any partially-created resources.`,
      }
    }

    const output = await run(tf, ["output", "-json"], { cwd: tfDir, timeoutMs: 30_000 })
    let publicIp: string | undefined
    let ocid: string | undefined
    try {
      const parsed = JSON.parse(output.stdout)
      publicIp = parsed.public_ip?.value
      ocid = parsed.instance_ocid?.value
    } catch {
      /* fall through -- reported below */
    }

    if (!publicIp) {
      setStep(state, "provision", "failed", "apply succeeded but no public IP was returned")
      state.status = "failed"
      state.errors.push("terraform apply succeeded but public_ip output was missing")
      await saveState(ctx.directory, state)
      return { title: "Provisioning inconsistent", output: "Terraform apply reported success but no public IP could be read from outputs. Inspect the Terraform state manually before proceeding." }
    }

    state.instance = {
      publicIp,
      ocid,
      shape: "VM.Standard.E2.1.Micro",
      sshUser: "ubuntu",
      sshKeyPath: path.join(keyDir, "deploy_id_ed25519"),
    }
    recordResource(state, { type: "oci_core_instance", id: ocid ?? "unknown", name: `cloudpilot-${state.appType}-${state.deploymentId}`, details: { publicIp } })
    setStep(state, "provision", "completed")
    log(state, `Provisioned instance ${ocid} at ${publicIp}`)
    await saveState(ctx.directory, state)

    return {
      title: "Infrastructure provisioned",
      output: `Instance is up.\n\nPublic IP: ${publicIp}\nInstance OCID: ${ocid}\n\nNote: the instance needs ~30-60s to finish booting before SSH is reachable. Next: deploy-app.`,
      metadata: { publicIp, ocid },
    }
  },
})

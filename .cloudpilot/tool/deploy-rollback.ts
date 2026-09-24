/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import path from "node:path"
import { commandExists, run } from "./_lib/exec"
import { log, loadState, saveState, setStep } from "./_lib/state"

export default tool({
  description: `HIGH IMPACT: destroys the cloud infrastructure created for a deployment. For oracle it runs \`terraform/tofu destroy\`; for aws/gcp/azure it approves the teardown and hands the exact destroy steps to the agent to run via the connected MCP server / provider CLI.

This is a human-approved rollback path, NOT an automatic error response -- it must be explicitly requested by the user (e.g. "roll back the deployment", "tear this down"). It is never triggered automatically just because a deployment step failed.`,
  args: {
    deployment_id: tool.schema.string().describe("The deploymentId to roll back / destroy"),
  },
  async execute(args, ctx) {
    const state = await loadState(ctx.directory, args.deployment_id)
    if (!state) return { title: "No such deployment", output: `No deployment found with id ${args.deployment_id}.` }
    if (!state.resources.length && !state.instance?.publicIp) {
      return { title: "Nothing to roll back", output: "No cloud resources are on record for this deployment -- nothing was provisioned, or it was already destroyed." }
    }

    if (state.provider !== "oracle") {
      await ctx.ask({
        permission: "deploy_rollback",
        patterns: [state.deploymentId],
        always: [],
        metadata: {
          summary: `About to DESTROY all ${state.provider} resources for deployment ${state.deploymentId} via the connected MCP server / ${state.provider} CLI:\n${state.resources.map((r) => `- ${r.type} ${r.id}`).join("\n") || "- (resources tracked via MCP -- see deployment state)"}\n\nThis is irreversible.`,
        },
      })
      state.status = "rolled_back"
      state.resources = []
      state.instance = undefined
      setStep(state, "complete", "cancelled")
      log(state, `Rollback approved for ${state.provider} -- agent destroys via MCP/CLI`)
      await saveState(ctx.directory, state)
      return {
        title: `Rollback approved: ${state.provider}`,
        output: `Teardown of ${state.provider} resources for deployment ${state.deploymentId} is approved. The agent must now destroy the VM + network via the connected MCP server / ${state.provider} CLI (do NOT simulate), then confirm with deploy-status.`,
        metadata: { deploymentId: state.deploymentId, provider: state.provider, via: "mcp" },
      }
    }

    const tf = (await commandExists("tofu")) ? "tofu" : (await commandExists("terraform")) ? "terraform" : undefined
    if (!tf) {
      return { title: "OpenTofu/Terraform not installed", output: "Neither `tofu` nor `terraform` is on PATH -- cannot run destroy. Resources on record:\n" + state.resources.map((r) => `- ${r.type} ${r.id}`).join("\n") }
    }

    const tfDir = path.join(ctx.directory, ".cloudpilot", "deploy", "terraform", state.deploymentId)

    await ctx.ask({
      permission: "deploy_rollback",
      patterns: [state.deploymentId],
      always: [],
      metadata: {
        summary: `About to DESTROY all Oracle Cloud resources for deployment ${state.deploymentId}:\n${state.resources.map((r) => `- ${r.type} ${r.id}`).join("\n")}\n\nThis is irreversible.`,
      },
    })

    ctx.metadata({ title: `Running ${tf} destroy` })
    const destroy = await run(tf, ["destroy", "-auto-approve", "-input=false"], {
      cwd: tfDir,
      timeoutMs: 600_000,
      onOutput: (chunk) => ctx.metadata({ title: `${tf} destroy`, metadata: { chunk } }),
    })

    log(state, `Rollback requested -> ${destroy.ok ? "ok" : "FAILED"}`)
    if (!destroy.ok) {
      state.errors.push(`terraform destroy failed: ${destroy.stderr || destroy.stdout}`)
      await saveState(ctx.directory, state)
      return { title: "Rollback failed", output: `\`${tf} destroy\` failed:\n\n${destroy.stderr || destroy.stdout}\n\nSome resources may still exist -- check the OCI Console.` }
    }

    state.status = "rolled_back"
    state.resources = []
    state.instance = undefined
    setStep(state, "complete", "cancelled")
    await saveState(ctx.directory, state)

    return { title: "Rolled back", output: `All Oracle Cloud resources for deployment ${state.deploymentId} were destroyed.` }
  },
})

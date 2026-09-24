/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { PROVIDERS, assertEnabled } from "./_lib/providers"

export default tool({
  description: `Connection gate for the user-chosen provider (oracle, aws, gcp, azure). Checks whether the provider is connected (via CLI auth and, where configured, via MCP). If connected, the agent proceeds with the next steps (deploy-requirements -> deploy-plan -> provision). If not connected, the agent must just notify the user what is missing and stop -- never proceed, never simulate.

This tool NEVER reads, prints, or stores secret key material -- it only checks presence/validity via the provider CLI itself.`,
  args: {
    provider: tool.schema.enum(["oracle", "aws", "gcp", "azure"]).describe("Cloud provider chosen by the user via the question tool"),
  },
  async execute(args, ctx) {
    assertEnabled(args.provider)
    ctx.metadata({ title: `Checking ${args.provider} connection` })
    const status = await PROVIDERS[args.provider].status(ctx.directory)
    if (status.connected) {
      return {
        title: `${status.name} connected`,
        output: [
          `✓ ${status.name} is connected -- ${status.detail}`,
          "",
          "Proceed with the next steps: deploy-requirements -> deploy-plan -> provision (via MCP/CLI) -> deploy-app -> deploy-status.",
        ].join("\n"),
        metadata: { ready: true, provider: args.provider, connected: true },
      }
    }
    return {
      title: `${status.name} not connected`,
      output: [
        `✗ ${status.name} is NOT connected -- ${status.detail}`,
        "",
        "Notify the user exactly what is missing (from the detail above) and stop. Do not proceed with requirements, planning, or provisioning until the provider is connected.",
      ].join("\n"),
      metadata: { ready: false, provider: args.provider, connected: false },
    }
  },
})

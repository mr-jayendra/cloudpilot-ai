/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { PROVIDERS } from "./_lib/providers"

export default tool({
  description: `Lists every cloud provider the Deploy Agent knows about, whether it is enabled, and whether it is currently connected (via CLI and, where configured, via MCP).

All providers (oracle, aws, gcp, azure) are enabled. The agent must ask the user (via the \`question\` tool) which provider to use, then drive deployments for that provider through the connected MCP server when one is configured (see .cloudpilot/cloudpilot.jsonc) or through the provider CLI otherwise.

Read-only and safe to call anytime; does not require credentials.`,
  args: {},
  async execute(_args, ctx) {
    ctx.metadata({ title: "Checking provider status" })
    const rows = await Promise.all(Object.values(PROVIDERS).map((p) => p.status(ctx.directory)))
    const lines = rows.map((r) => {
      const via = r.connected && r.via ? ` via ${r.via.toUpperCase()}` : ""
      const state = !r.enabled ? "DISABLED" : r.connected ? "CONNECTED" : "NOT CONNECTED"
      return `${r.enabled ? "●" : "○"} ${r.name} [${state}${via}] -- ${r.detail}`
    })
    return {
      title: "Provider status",
      output: lines.join("\n"),
      metadata: { providers: rows },
    }
  },
})

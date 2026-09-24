/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { ssh } from "./_lib/exec"
import { loadState } from "./_lib/state"

export default tool({
  description: `Read-only. Fetches recent logs for the deployed application (via \`journalctl\` for the cloudpilot-app systemd service) over SSH, plus the local deployment event log kept for this deployment. Use this when the user asks "why did it fail" / "check the logs" / "what's happening".`,
  args: {
    deployment_id: tool.schema.string().optional().describe("Deployment to fetch logs for; defaults to the most recent one"),
    lines: tool.schema.number().default(100).describe("Number of recent remote log lines to fetch"),
  },
  async execute(args, ctx) {
    const state = await loadState(ctx.directory, args.deployment_id)
    if (!state) return { title: "No deployments found", output: "No deployment has been started for this project yet." }

    const sections: string[] = [`Local deployment event log (${state.deploymentId}):`, ...state.logs.slice(-50), ""]

    if (state.instance?.publicIp && state.instance.sshKeyPath) {
      ctx.metadata({ title: "Fetching remote logs" })
      const result = await ssh(
        state.instance.publicIp,
        state.instance.sshUser ?? "ubuntu",
        state.instance.sshKeyPath,
        `sudo journalctl -u cloudpilot-app -n ${args.lines} --no-pager 2>&1 || true`,
      )
      sections.push(`Remote service logs (last ${args.lines} lines):`, result.ok ? result.stdout || "(no log output yet)" : `Could not fetch remote logs: ${result.stderr || result.stdout}`)
    } else {
      sections.push("No provisioned instance yet -- nothing to fetch remotely.")
    }

    return { title: `Logs for ${state.deploymentId}`, output: sections.join("\n") }
  },
})

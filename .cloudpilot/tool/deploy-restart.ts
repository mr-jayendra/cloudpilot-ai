/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { ssh } from "./_lib/exec"
import { loadState, log, saveState } from "./_lib/state"

export default tool({
  description: `Restarts the deployed application's systemd service on the remote instance. Requires explicit approval since it affects a running production-like service, even briefly.`,
  args: {
    deployment_id: tool.schema.string().optional().describe("Deployment to restart; defaults to the most recent one"),
  },
  async execute(args, ctx) {
    const state = await loadState(ctx.directory, args.deployment_id)
    if (!state || !state.instance?.publicIp || !state.instance.sshKeyPath) {
      return { title: "Nothing to restart", output: "No deployed instance found for this project." }
    }

    await ctx.ask({
      permission: "deploy_restart",
      patterns: [state.deploymentId],
      always: [],
      metadata: { summary: `About to restart the "cloudpilot-app" service on ${state.instance.publicIp}. The app will be briefly unavailable.` },
    })

    ctx.metadata({ title: `Restarting service on ${state.instance.publicIp}` })
    const result = await ssh(state.instance.publicIp, state.instance.sshUser ?? "ubuntu", state.instance.sshKeyPath, "sudo systemctl restart cloudpilot-app && sleep 1 && systemctl is-active cloudpilot-app")
    log(state, `Restart requested -> ${result.ok ? "ok" : "failed"}`)
    await saveState(ctx.directory, state)

    if (!result.ok) {
      return { title: "Restart failed", output: `Could not restart the service:\n\n${result.stderr || result.stdout}` }
    }
    return { title: "Service restarted", output: `Service restarted. Current state: ${result.stdout.trim()}` }
  },
})

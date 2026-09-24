/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { ssh } from "./_lib/exec"
import { loadState, log, renderProcessLine, saveState, setStep } from "./_lib/state"

export default tool({
  description: `Read-only. Reports the current status of a deployment: which step it's on, the process line (matching the sidebar's deployment progress view), and -- if the instance is up -- a live health check (checks the systemd service and curls the app port over SSH). Never fabricates a "running"/"healthy" result; if the check can't be performed or fails, it says so plainly.

Omit deployment_id to check the most recent deployment.`,
  args: {
    deployment_id: tool.schema.string().optional().describe("Deployment to check; defaults to the most recent one"),
  },
  async execute(args, ctx) {
    const state = await loadState(ctx.directory, args.deployment_id)
    if (!state) {
      return { title: "No deployments found", output: "No deployment has been started for this project yet. Use deploy-plan to create one." }
    }

    const lines = [
      `Deployment ${state.deploymentId}`,
      `Provider: ${state.provider}   Region: ${state.region ?? "unknown"}`,
      `App type: ${state.appType ?? "unknown"}   Port: ${state.appPort ?? "unknown"}`,
      `Status: ${state.status}`,
      "",
      renderProcessLine(state),
    ]

    if (state.instance?.publicIp) {
      lines.push("", `Instance: ${state.instance.publicIp} (${state.instance.ocid ?? "unknown OCID"})`)

      if (state.instance.sshKeyPath) {
        ctx.metadata({ title: "Running live health check" })
        const svc = await ssh(state.instance.publicIp, state.instance.sshUser ?? "ubuntu", state.instance.sshKeyPath, "systemctl is-active cloudpilot-app || true")
        const curl = await ssh(
          state.instance.publicIp,
          state.instance.sshUser ?? "ubuntu",
          state.instance.sshKeyPath,
          `curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:${state.appPort ?? 8080}/ || true`,
        )
        const serviceState = svc.ok ? svc.stdout.trim() : "unreachable (SSH failed)"
        const httpCode = curl.ok ? curl.stdout.trim() : "unreachable"
        lines.push(`systemd service: ${serviceState}`, `HTTP check on port ${state.appPort ?? 8080}: ${httpCode || "no response"}`)

        const healthy = serviceState === "active" && /^2|3/.test(httpCode)
        if (state.status === "verifying") {
          if (healthy) {
            setStep(state, "health_check", "completed")
            setStep(state, "complete", "completed")
            state.status = "running"
            state.completedAt = new Date().toISOString()
            log(state, "Health check passed")
          } else {
            setStep(state, "health_check", "failed", `service=${serviceState} http=${httpCode}`)
            log(state, `Health check did not pass: service=${serviceState} http=${httpCode}`)
          }
          await saveState(ctx.directory, state)
        }
      } else {
        lines.push("No SSH key on record for this deployment -- cannot run a live health check.")
      }
    }

    if (state.errors.length) {
      lines.push("", "Errors:", ...state.errors.map((e) => `- ${e}`))
    }

    return {
      title: `Deployment ${state.deploymentId}: ${state.status}`,
      output: lines.join("\n"),
      metadata: { state },
    }
  },
})

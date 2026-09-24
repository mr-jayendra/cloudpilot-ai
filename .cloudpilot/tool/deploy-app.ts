/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { detectApp } from "./_lib/detect"
import { rsyncUpload, ssh } from "./_lib/exec"
import { log, loadState, saveState, setStep } from "./_lib/state"

function systemdUnit(appType: string, workdir: string, startCommand: string, port: number): string {
  return `[Unit]
Description=CloudPilot deployed application
After=network.target

[Service]
Type=simple
WorkingDirectory=${workdir}
ExecStart=/bin/bash -lc '${startCommand.replace(/'/g, "'\\''")}'
Environment=PORT=${port}
Restart=on-failure
RestartSec=3
User=ubuntu

[Install]
WantedBy=multi-user.target
`
}

export default tool({
  description: `HIGH IMPACT: uploads the current project to the provisioned cloud instance (any provider: oracle, aws, gcp, azure -- provisioned via MCP/CLI), installs its runtime dependencies, builds it if needed, and starts it as a systemd service.

Requires a provisioned instance with a public IP + SSH key (run the provision step for the chosen provider first, via MCP/CLI for non-Oracle). Asks for explicit approval showing exactly which remote commands will run before executing anything. Never reports success unless the remote commands actually succeeded.`,
  args: {
    deployment_id: tool.schema.string().describe("The deploymentId to deploy the application for"),
  },
  async execute(args, ctx) {
    const state = await loadState(ctx.directory, args.deployment_id)
    if (!state) return { title: "No such deployment", output: `No deployment found with id ${args.deployment_id}.` }
    if (!state.instance?.publicIp || !state.instance.sshKeyPath) {
      return { title: "No provisioned instance", output: "This deployment has no provisioned instance yet. Provision it first via the connected MCP server / provider CLI (deploy-provision), then retry." }
    }

    const detection = await detectApp(ctx.directory)
    const startCommand = detection.startCommand
    if (!startCommand) {
      return {
        title: "Cannot determine start command",
        output: "No start command could be determined for this application. Ask the user how the app should be started, then retry (this tool currently relies on auto-detection).",
      }
    }

    const { publicIp, sshUser = "ubuntu", sshKeyPath } = state.instance
    const remoteDir = "/home/ubuntu/app"
    const runtimeInstall =
      detection.appType === "node"
        ? "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
        : detection.appType === "python"
          ? "sudo apt-get update -y && sudo apt-get install -y python3 python3-pip python3-venv"
          : detection.appType === "go"
            ? "sudo snap install go --classic"
            : "echo 'no additional runtime needed'"

    const remoteCommands = [
      `sudo mkdir -p ${remoteDir} && sudo chown ${sshUser}:${sshUser} ${remoteDir}`,
      runtimeInstall,
      detection.installCommand ? `cd ${remoteDir} && ${detection.installCommand}` : "true",
      detection.buildCommand ? `cd ${remoteDir} && ${detection.buildCommand}` : "true",
      "sudo systemctl daemon-reload && sudo systemctl enable cloudpilot-app && sudo systemctl restart cloudpilot-app",
    ]

    await ctx.ask({
      permission: "deploy_app",
      patterns: [state.deploymentId],
      always: [],
      metadata: {
        summary: `About to upload the project to ${publicIp}:${remoteDir} and run:\n${remoteCommands.map((c) => `  $ ${c}`).join("\n")}\n\nThis will create/replace a systemd service "cloudpilot-app" running: ${startCommand}`,
      },
    })

    setStep(state, "configure", "running")
    state.status = "deploying"
    log(state, `Uploading project to ${publicIp}:${remoteDir}`)
    await saveState(ctx.directory, state)

    ctx.metadata({ title: `Uploading application to ${publicIp}` })
    const upload = await rsyncUpload(ctx.directory, publicIp, sshUser, sshKeyPath, remoteDir, {
      onOutput: (chunk) => ctx.metadata({ title: "Uploading application", metadata: { chunk } }),
    })
    if (!upload.ok) {
      setStep(state, "configure", "failed", upload.stderr || upload.stdout)
      state.status = "failed"
      state.errors.push(`rsync upload failed: ${upload.stderr || upload.stdout}`)
      await saveState(ctx.directory, state)
      return { title: "Upload failed", output: `Failed to upload the application via rsync:\n\n${upload.stderr || upload.stdout}` }
    }
    setStep(state, "configure", "completed")

    // Write the systemd unit file remotely, then run install/build/start.
    const unit = systemdUnit(detection.appType, remoteDir, startCommand, state.appPort ?? 8080)
    const writeUnit = await ssh(
      publicIp,
      sshUser,
      sshKeyPath,
      `sudo tee /etc/systemd/system/cloudpilot-app.service > /dev/null << 'EOF'\n${unit}\nEOF`,
    )
    if (!writeUnit.ok) {
      state.status = "failed"
      state.errors.push(`failed to write systemd unit: ${writeUnit.stderr || writeUnit.stdout}`)
      await saveState(ctx.directory, state)
      return { title: "Failed to configure service", output: writeUnit.stderr || writeUnit.stdout }
    }

    setStep(state, "deploy_app", "running")
    for (const command of remoteCommands) {
      ctx.metadata({ title: `Running: ${command.slice(0, 60)}` })
      const result = await ssh(publicIp, sshUser, sshKeyPath, command, { timeoutMs: 300_000 })
      log(state, `$ ${command} -> ${result.ok ? "ok" : "FAILED"}`)
      if (!result.ok) {
        setStep(state, "deploy_app", "failed", result.stderr || result.stdout)
        state.status = "failed"
        state.errors.push(`Remote command failed: "${command}": ${result.stderr || result.stdout}`)
        await saveState(ctx.directory, state)
        return {
          title: "Application deployment failed",
          output: `Command failed on the remote instance:\n\n$ ${command}\n\n${result.stderr || result.stdout}\n\nThe deployment is marked failed. Use deploy-logs to investigate, fix the underlying issue, then retry deploy-app.`,
        }
      }
    }

    setStep(state, "deploy_app", "completed")
    state.status = "verifying"
    await saveState(ctx.directory, state)

    return {
      title: "Application deployed",
      output: `Application uploaded and started as a systemd service on ${publicIp}. Next: deploy-status (or the agent should run a health check) to confirm it's actually serving traffic on port ${state.appPort}.`,
    }
  },
})

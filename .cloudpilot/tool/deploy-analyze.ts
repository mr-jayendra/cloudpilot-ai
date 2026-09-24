/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { detectApp } from "./_lib/detect"

export default tool({
  description: `Analyzes the current project to determine what kind of application it is (Node.js, Python, Go, static site, Docker, or unknown), and infers its build command, start command, install command, and port.

Read-only: inspects files on disk only, makes no network calls and touches no cloud resources. Always run this before generating a deployment plan.`,
  args: {},
  async execute(_args, ctx) {
    ctx.metadata({ title: "Analyzing project" })
    const detection = await detectApp(ctx.directory)

    const summary = [
      `Detected app type: ${detection.appType}`,
      ...detection.reasons.map((r) => `- ${r}`),
      "",
      `Install command: ${detection.installCommand ?? "(none detected)"}`,
      `Build command: ${detection.buildCommand ?? "(none needed)"}`,
      `Start command: ${detection.startCommand ?? "(not detected)"}`,
      `Port: ${detection.port ?? "(not detected)"}`,
      detection.hasDocker ? "A Dockerfile is present." : "",
      detection.hasDockerCompose ? "A docker-compose file is present." : "",
      ...(detection.warnings.length ? ["", "Warnings:", ...detection.warnings.map((w) => `- ${w}`)] : []),
    ]
      .filter(Boolean)
      .join("\n")

    return {
      title: `Detected ${detection.appType} app`,
      output: summary,
      metadata: { detection },
    }
  },
})

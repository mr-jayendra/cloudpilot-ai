/// <reference path="../env.d.ts" />
// Pure requirements-report builder for the Deploy Agent.
//
// Takes deterministic project detection + a user-chosen provider and renders
// a human-readable cloud-requirements report. No I/O, no network, no cloud
// calls -- safe to call from any tool. The agent shows this report to the
// user (via the `question` tool) for confirmation/suggestions before any
// provisioning happens.

import type { AppDetection } from "./detect"

export type ProviderId = "oracle" | "aws" | "gcp" | "azure"

export interface RequirementsInput {
  provider: ProviderId
  region?: string
  detection: AppDetection
  suggestions?: string
}

export interface RequirementsReport {
  provider: ProviderId
  region?: string
  appType: string
  appPort: number
  runtime: string
  buildCommand?: string
  installCommand?: string
  startCommand?: string
  compute: string
  network: string[]
  storage: string[]
  env: string[]
  warnings: string[]
  suggestions?: string
  summary: string
}

function runtimeFor(detection: AppDetection): string {
  if (detection.appType === "node") return `Node.js 20 (${detection.packageManager ?? "npm"})`
  if (detection.appType === "python") return "Python 3 + pip"
  if (detection.appType === "go") return "Go toolchain"
  if (detection.appType === "static") return "Static file hosting (no runtime)"
  if (detection.appType === "docker") return "Docker engine"
  return "Unknown -- user must confirm runtime"
}

function computeFor(provider: ProviderId): string {
  if (provider === "oracle") return "1x VM.Standard.E2.1.Micro (Free Tier, Ubuntu 22.04)"
  if (provider === "aws") return "1x t3.micro or t4g.micro (Free Tier eligible) via MCP/CLI"
  if (provider === "gcp") return "1x e2-micro (Free Tier eligible) via MCP/CLI"
  return "1x B1s (Free Tier eligible) via MCP/CLI"
}

export function buildRequirements(input: RequirementsInput): RequirementsReport {
  const detection = input.detection
  const port = detection.port ?? 8080
  const network = [`Inbound TCP 22 (SSH)`, `Inbound TCP ${port} (app)`]
  const storage = ["Root disk (default, ~30GB or provider default)"]
  if (detection.appType === "node") storage.push("node_modules installed at deploy time (not uploaded)")
  const env = [`PORT=${port}`]
  const summary = [
    `Cloud requirements report (${input.provider}${input.region ? `, ${input.region}` : ""}):`,
    "",
    `App type: ${detection.appType}`,
    `Runtime: ${runtimeFor(detection)}`,
    `Install: ${detection.installCommand ?? "(none detected)"}`,
    `Build: ${detection.buildCommand ?? "(none needed)"}`,
    `Start: ${detection.startCommand ?? "(not detected -- confirm with user)"}`,
    `Port: ${port}`,
    `Compute: ${computeFor(input.provider)}`,
    `Network: ${network.join("; ")}`,
    `Storage: ${storage.join("; ")}`,
    `Env: ${env.join("; ")}`,
    detection.hasDocker ? "Note: a Dockerfile is present in the project." : "",
    detection.hasDockerCompose ? "Note: a docker-compose file is present in the project." : "",
    ...(detection.warnings.length ? ["", "Warnings:", ...detection.warnings.map((w) => `- ${w}`)] : []),
    ...(input.suggestions ? ["", `User suggestions: ${input.suggestions}`] : []),
    "",
    "Confirm this report (or suggest changes) before any provisioning runs. After approval, the agent executes the rest via the connected MCP server / provider CLI.",
  ]
    .filter(Boolean)
    .join("\n")
  return {
    provider: input.provider,
    region: input.region,
    appType: detection.appType,
    appPort: port,
    runtime: runtimeFor(detection),
    buildCommand: detection.buildCommand,
    installCommand: detection.installCommand,
    startCommand: detection.startCommand,
    compute: computeFor(input.provider),
    network,
    storage,
    env,
    warnings: detection.warnings,
    suggestions: input.suggestions,
    summary,
  }
}

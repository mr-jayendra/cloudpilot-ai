// Deployment state persistence for the Deploy Agent.
//
// Reuses the project's own filesystem instead of introducing a database:
// state lives under <project>/.cloudpilot/deploy/, alongside the same
// project's plans/skills/etc. `latest.json` always points at the most
// recent deployment so tools invoked without an explicit id "just work";
// the full history is kept under history/<id>.json so nothing is lost.

import { promises as fs } from "node:fs"
import path from "node:path"

export type StepStatus = "pending" | "running" | "waiting_for_approval" | "completed" | "failed" | "skipped" | "cancelled"

export interface DeployStep {
  id: string
  label: string
  status: StepStatus
  startedAt?: string
  completedAt?: string
  error?: string
}

export type ProviderId = "oracle" | "aws" | "gcp" | "azure"

export type DeploymentStatus =
  | "analyzing"
  | "planning"
  | "awaiting_approval"
  | "provisioning"
  | "deploying"
  | "verifying"
  | "running"
  | "failed"
  | "rolled_back"
  | "destroyed"

export interface DeployResource {
  type: string
  id: string
  name?: string
  createdAt: string
  details?: Record<string, unknown>
}

export interface DeploymentState {
  deploymentId: string
  provider: ProviderId
  region?: string
  compartmentId?: string
  target?: string
  appType?: string
  appPort?: number
  status: DeploymentStatus
  currentStep?: string
  steps: DeployStep[]
  startedAt: string
  completedAt?: string
  errors: string[]
  logs: string[]
  approvals: { step: string; approvedAt: string; summary: string }[]
  resources: DeployResource[]
  plan?: Record<string, unknown>
  instance?: {
    publicIp?: string
    ocid?: string
    shape?: string
    sshUser?: string
    sshKeyPath?: string
  }
}

function deployDir(projectDir: string) {
  return path.join(projectDir, ".cloudpilot", "deploy")
}

function historyDir(projectDir: string) {
  return path.join(deployDir(projectDir), "history")
}

function latestPointerFile(projectDir: string) {
  return path.join(deployDir(projectDir), "latest.json")
}

export function newDeploymentId(): string {
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
  const rand = Math.random().toString(36).slice(2, 6)
  return `dep_${stamp}_${rand}`
}

export async function ensureDirs(projectDir: string) {
  await fs.mkdir(historyDir(projectDir), { recursive: true })
  await fs.mkdir(path.join(deployDir(projectDir), "terraform"), { recursive: true })
  await fs.mkdir(path.join(deployDir(projectDir), "keys"), { recursive: true })
}

export async function saveState(projectDir: string, state: DeploymentState) {
  await ensureDirs(projectDir)
  const file = path.join(historyDir(projectDir), `${state.deploymentId}.json`)
  await fs.writeFile(file, JSON.stringify(state, null, 2), "utf8")
  await fs.writeFile(latestPointerFile(projectDir), JSON.stringify({ deploymentId: state.deploymentId }, null, 2), "utf8")
  return state
}

export async function loadState(projectDir: string, deploymentId?: string): Promise<DeploymentState | undefined> {
  try {
    let id = deploymentId
    if (!id) {
      const pointer = JSON.parse(await fs.readFile(latestPointerFile(projectDir), "utf8"))
      id = pointer.deploymentId
    }
    if (!id) return undefined
    const file = path.join(historyDir(projectDir), `${id}.json`)
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return undefined
  }
}

export function newState(input: { provider: ProviderId; region?: string; compartmentId?: string }): DeploymentState {
  return {
    deploymentId: newDeploymentId(),
    provider: input.provider,
    region: input.region,
    compartmentId: input.compartmentId,
    status: "analyzing",
    steps: [],
    startedAt: new Date().toISOString(),
    errors: [],
    logs: [],
    approvals: [],
    resources: [],
  }
}

export function initSteps(state: DeploymentState, steps: { id: string; label: string }[]) {
  state.steps = steps.map((s) => ({ id: s.id, label: s.label, status: "pending" as StepStatus }))
}

export function setStep(state: DeploymentState, stepId: string, status: StepStatus, error?: string) {
  const step = state.steps.find((s) => s.id === stepId)
  if (!step) return
  step.status = status
  if (status === "running") step.startedAt = new Date().toISOString()
  if (status === "completed" || status === "failed" || status === "cancelled" || status === "skipped") {
    step.completedAt = new Date().toISOString()
  }
  if (error) step.error = error
  state.currentStep = status === "running" || status === "waiting_for_approval" ? stepId : state.currentStep
}

export function log(state: DeploymentState, message: string) {
  state.logs.push(`[${new Date().toISOString()}] ${message}`)
  // keep logs bounded so state.json doesn't grow without bound
  if (state.logs.length > 500) state.logs = state.logs.slice(-500)
}

export function recordApproval(state: DeploymentState, step: string, summary: string) {
  state.approvals.push({ step, approvedAt: new Date().toISOString(), summary })
}

export function recordResource(state: DeploymentState, resource: Omit<DeployResource, "createdAt">) {
  state.resources.push({ ...resource, createdAt: new Date().toISOString() })
}

export function renderProcessLine(state: DeploymentState): string {
  const icon: Record<StepStatus, string> = {
    completed: "✓",
    running: "●",
    waiting_for_approval: "●",
    pending: "○",
    failed: "✗",
    skipped: "⊘",
    cancelled: "⊘",
  }
  const lines = ["DEPLOYMENT", ""]
  for (const step of state.steps) {
    const marker = icon[step.status]
    const suffix = step.status === "waiting_for_approval" ? " (waiting for approval)" : step.status === "failed" ? ` (failed: ${step.error ?? "unknown error"})` : ""
    lines.push(`${marker} ${step.label}${suffix}`)
  }
  return lines.join("\n")
}

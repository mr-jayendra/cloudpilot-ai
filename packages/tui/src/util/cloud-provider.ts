import path from "path"
import { Global } from "@cloudpilot-ai/core/global"
import { readJson } from "./persistence"

export type CloudProviderItem = {
  value: string
  title: string
  description: string
}

export const CLOUD_PROVIDERS: CloudProviderItem[] = [
  { value: "aws", title: "AWS", description: "Amazon Web Services" },
  { value: "oracle", title: "Oracle Cloud", description: "Oracle Cloud Infrastructure" },
  { value: "google-cloud", title: "Google Cloud", description: "Google Cloud Platform" },
  { value: "azure", title: "Microsoft Azure", description: "Microsoft Azure" },
]

export type CloudProviderStatusEntry = {
  connected: boolean
  profile?: string
  region?: string
  project?: string
  location?: string
  subscriptionId?: string
  verifiedAt?: string
  accountId?: string
}

export type CloudProviderStatus = Record<string, CloudProviderStatusEntry>

// Minimal AWS connection mode used to pick the smallest sufficient prompt.
// Derived only from already-available marker + MCP status, no shell calls:
// - "fresh": nothing configured yet, full setup required once.
// - "repair": marker exists but aws-mcp missing from CloudPilot, only re-register MCP.
// - "reauth": marker and/or MCP exist, only verify auth and refresh marker.
// Adding this type is additive; existing readers of CloudProviderStatus are unaffected.
export type AwsConnectionMode = "fresh" | "repair" | "reauth"

export function getAwsConnectionMode(input: {
  markerConnected: boolean
  mcpConnected: boolean
}): AwsConnectionMode {
  if (input.markerConnected && !input.mcpConnected) return "repair"
  if (input.markerConnected || input.mcpConnected) return "reauth"
  return "fresh"
}

// Marker file written by the agent after a verified provider setup.
// Lives in the shared global config dir so both the server-side agent
// (write tool) and the TUI (Bun.file read) see the same file.
// Note: a custom CLOUDPILOT_CONFIG_DIR moves the server config but not
// this XDG path; acceptable for the Connect-flow MVP.
export function cloudProviderStatusPath() {
  return path.join(Global.Path.config, "cloud-providers.json")
}

// Agent prompts historically wrote the Windows marker to
// %APPDATA%\cloudpilot\cloud-providers.json while the TUI reads
// Global.Path.config (xdg-based, ~/.config on this machine).
// Read every candidate and merge so a marker written to either location counts.
// Additive: existing single-path readers keep working via cloudProviderStatusPath().
export function cloudProviderStatusPaths(): string[] {
  const out = new Set<string>()
  out.add(cloudProviderStatusPath())
  const appData = process.env.APPDATA
  if (appData) out.add(path.join(appData, "cloudpilot", "cloud-providers.json"))
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) out.add(path.join(xdg, "cloudpilot", "cloud-providers.json"))
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home) out.add(path.join(home, ".config", "cloudpilot", "cloud-providers.json"))
  return [...out]
}

function isStatusEntry(value: unknown): value is CloudProviderStatusEntry {
  if (!value || typeof value !== "object") return false
  return (value as { connected?: unknown }).connected === true
}

export async function readCloudProviderStatus(): Promise<CloudProviderStatus> {
  const out: CloudProviderStatus = {}
  for (const candidate of cloudProviderStatusPaths()) {
    const parsed = await readJson<unknown>(candidate).catch(() => undefined)
    if (!parsed || typeof parsed !== "object") continue
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isStatusEntry(value)) out[key] = value
    }
  }
  return out
}

export async function isCloudProviderConnected(id: string) {
  const status = await readCloudProviderStatus()
  return status[id]?.connected === true
}

export async function getConnectedCloudProviders() {
  const status = await readCloudProviderStatus()
  return CLOUD_PROVIDERS.filter((item) => status[item.value]?.connected === true)
}

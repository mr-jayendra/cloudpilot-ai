// Provider abstraction for the Deploy Agent.
//
// The orchestrator (the deploy-* tools) should only ever call through this
// interface, never branch on "if provider === oracle" directly. All four
// providers are enabled: Oracle via OCI CLI + OpenTofu, AWS/GCP/Azure via
// their CLIs and, where configured, via connected MCP servers (see
// .cloudpilot/cloudpilot.jsonc). The agent picks the provider from the
// user's answer (asked via the `question` tool) and passes it through.
//
// A provider counts as CONNECTED when either its CLI authenticates or an
// MCP server for it is configured -- CLI-only checks would wrongly report
// "not connected" on machines that deploy purely through MCP.

import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { commandExists, run } from "./exec"

export interface ProviderStatus {
  id: string
  name: string
  enabled: boolean
  connected: boolean
  /** "cli" when the provider CLI authenticated, "mcp" when an MCP server covers it. */
  via?: "cli" | "mcp"
  detail: string
}

export interface CloudProvider {
  id: "oracle" | "aws" | "gcp" | "azure"
  name: string
  enabled: boolean
  /** Checks CLI auth + configured MCP servers, without ever printing secrets. */
  status(projectDir?: string): Promise<ProviderStatus>
}

// Explicit MCP server name -> provider mapping, plus a name heuristic
// below for servers that follow the "<provider>-..." convention.
const MCP_SERVER_PROVIDERS: Record<string, "oracle" | "aws" | "gcp" | "azure"> = {
  "aws-mcp": "aws",
}

function mcpServerProvider(serverName: string): "oracle" | "aws" | "gcp" | "azure" | undefined {
  const mapped = MCP_SERVER_PROVIDERS[serverName]
  if (mapped) return mapped
  const lower = serverName.toLowerCase()
  if (lower.includes("aws") || lower.includes("amazon")) return "aws"
  if (lower.includes("gcp") || lower.includes("google")) return "gcp"
  if (lower.includes("azure")) return "azure"
  if (lower.includes("oracle") || lower.includes("oci")) return "oracle"
  return undefined
}

// Minimal string-aware JSONC parser (no dependency): removes // line
// comments, /* */ blocks, and trailing commas outside of string literals,
// so URLs like "https://..." and trailing-comma configs survive intact.
function parseJsonc(text: string): any {
  let out = ""
  let i = 0
  let inString: string | undefined
  let escaped = false
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === inString) inString = undefined
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch
      out += ch
      i++
      continue
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (ch === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (ch === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === "}" || text[j] === "]") {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return JSON.parse(out)
}

async function readJsoncFile(file: string): Promise<any | undefined> {
  try {
    const text = await fs.readFile(file, "utf8")
    return parseJsonc(text)
  } catch {
    return undefined
  }
}

/** MCP server names configured in the project and global cloudpilot configs. */
export async function configuredMcpServers(projectDir?: string): Promise<string[]> {
  const candidates: string[] = []
  if (projectDir) {
    candidates.push(
      path.join(projectDir, ".cloudpilot", "cloudpilot.jsonc"),
      path.join(projectDir, ".cloudpilot", "cloudpilot.json"),
    )
  }
  const globalDir = path.join(os.homedir(), ".config", "cloudpilot")
  candidates.push(path.join(globalDir, "cloudpilot.jsonc"), path.join(globalDir, "cloudpilot.json"))
  const names: string[] = []
  for (const file of candidates) {
    const parsed = await readJsoncFile(file)
    const servers = parsed?.mcp?.servers
    if (servers && typeof servers === "object") {
      for (const name of Object.keys(servers)) {
        if (!names.includes(name)) names.push(name)
      }
    }
  }
  return names
}

/** MCP server covering this provider, if one is configured. */
export async function mcpServerFor(
  providerId: "oracle" | "aws" | "gcp" | "azure",
  projectDir?: string,
): Promise<string | undefined> {
  const servers = await configuredMcpServers(projectDir)
  return servers.find((name) => mcpServerProvider(name) === providerId)
}

class OracleProvider implements CloudProvider {
  id = "oracle" as const
  name = "Oracle Cloud (Free Tier)"
  enabled = true

  async status(projectDir?: string): Promise<ProviderStatus> {
    const hasCli = await commandExists("oci")
    if (!hasCli) {
      const mcp = await mcpServerFor(this.id, projectDir)
      if (mcp) {
        return {
          id: this.id,
          name: this.name,
          enabled: this.enabled,
          connected: true,
          via: "mcp",
          detail: `Connected via MCP server "${mcp}" (configured in cloudpilot.jsonc). OCI CLI is not installed, so CLI-based flows are unavailable.`,
        }
      }
      return {
        id: this.id,
        name: this.name,
        enabled: this.enabled,
        connected: false,
        detail: "OCI CLI is not installed. Install it from https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm, then run `oci setup config`.",
      }
    }
    // `oci iam region-subscription list` requires a working config/auth and touches no state.
    const result = await run("oci", ["iam", "region-subscription", "list", "--output", "json"], { timeoutMs: 15_000 })
    if (!result.ok) {
      const mcp = await mcpServerFor(this.id, projectDir)
      if (mcp) {
        return {
          id: this.id,
          name: this.name,
          enabled: this.enabled,
          connected: true,
          via: "mcp",
          detail: `Connected via MCP server "${mcp}" (configured in cloudpilot.jsonc). OCI CLI is installed but not authenticated.`,
        }
      }
      return {
        id: this.id,
        name: this.name,
        enabled: this.enabled,
        connected: false,
        detail: "OCI CLI is installed but not authenticated (or the configured profile is invalid). Run `oci setup config` to connect a profile.",
      }
    }
    let regionCount = 0
    try {
      regionCount = JSON.parse(result.stdout).length
    } catch {
      /* ignore parse issues, connection itself already succeeded */
    }
    return {
      id: this.id,
      name: this.name,
      enabled: this.enabled,
      connected: true,
      via: "cli",
      detail: `Connected via OCI CLI. Tenancy is subscribed to ${regionCount || "at least one"} region(s).`,
    }
  }
}

function cliProvider(
  id: "aws" | "gcp" | "azure",
  name: string,
  cli: string,
  installHint: string,
  authProbe: string[],
): CloudProvider {
  return {
    id,
    name,
    enabled: true,
    async status(projectDir?: string) {
      const hasCli = await commandExists(cli)
      if (hasCli) {
        const result = await run(authProbe[0], authProbe.slice(1), { timeoutMs: 15_000 })
        if (result.ok) {
          return {
            id,
            name,
            enabled: true,
            connected: true,
            via: "cli",
            detail: `Connected via ${cli} CLI. A configured MCP server can also drive deployments for ${name}.`,
          }
        }
      }
      // CLI missing or unauthenticated -- fall back to a configured MCP server.
      const mcp = await mcpServerFor(id, projectDir)
      if (mcp) {
        return {
          id,
          name,
          enabled: true,
          connected: true,
          via: "mcp",
          detail: `Connected via MCP server "${mcp}" (configured in cloudpilot.jsonc). ${hasCli ? `${cli} CLI is installed but not authenticated.` : `${cli} CLI is not installed, so CLI-based flows are unavailable.`}`,
        }
      }
      return {
        id,
        name,
        enabled: true,
        connected: false,
        detail: hasCli
          ? `${cli} CLI is installed but not authenticated, and no MCP server for ${name} is configured. Authenticate the CLI first, or configure an MCP server (see .cloudpilot/cloudpilot.jsonc).`
          : `${cli} CLI is not installed, and no MCP server for ${name} is configured. ${installHint} Or configure an MCP server (see .cloudpilot/cloudpilot.jsonc).`,
      }
    },
  }
}

export const PROVIDERS: Record<string, CloudProvider> = {
  oracle: new OracleProvider(),
  aws: cliProvider(
    "aws",
    "Amazon Web Services",
    "aws",
    "Install AWS CLI v2 from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html, then run `aws configure` or `aws sso login`.",
    ["aws", "sts", "get-caller-identity", "--output", "json"],
  ),
  gcp: cliProvider(
    "gcp",
    "Google Cloud",
    "gcloud",
    "Install gcloud from https://cloud.google.com/sdk/docs/install, then run `gcloud auth login`.",
    ["gcloud", "auth", "list", "--format=json"],
  ),
  azure: cliProvider(
    "azure",
    "Microsoft Azure",
    "az",
    "Install Azure CLI from https://learn.microsoft.com/cli/azure/install-azure-cli, then run `az login`.",
    ["az", "account", "show", "--output", "json"],
  ),
}

export function getProvider(id: string): CloudProvider | undefined {
  return PROVIDERS[id]
}

export function assertEnabled(id: string): CloudProvider {
  const provider = PROVIDERS[id]
  if (!provider) throw new Error(`Unknown provider "${id}". Available: ${Object.keys(PROVIDERS).join(", ")}`)
  if (!provider.enabled) {
    throw new Error(`${provider.name} is disabled in this release.`)
  }
  return provider
}

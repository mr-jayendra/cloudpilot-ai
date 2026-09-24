import { createResource } from "solid-js"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useToast } from "../ui/toast"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"
import { CLOUD_PROVIDERS, getAwsConnectionMode, readCloudProviderStatus } from "../util/cloud-provider"
import type { PromptRef } from "./prompt"

// MCP server entries written by each provider setup (see per-provider prompts).
const MCP_NAME = {
  aws: "aws-mcp",
  oracle: "oracle-mcp",
  "google-cloud": "gcloud-mcp",
  azure: "azure-mcp",
} as const

function Status(props: { connected: boolean }) {
  const { theme } = useTheme()
  if (props.connected) {
    return <span style={{ fg: theme.success, attributes: TextAttributes.BOLD }}>✓ Connected</span>
  }
  return <span style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>＋ Connect</span>
}

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_]*$/
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d+$/
const NON_BLANK_PATTERN = /\S/
const GCP_PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/
const GCP_REGION_PATTERN = /^[a-z]+-[a-z0-9]+\d+[a-z]?$/
const AZURE_LOCATION_PATTERN = /^[a-z0-9]+$/

function buildAwsFreshPrompt(input: { profile: string; region: string; experience: "new" | "advanced" }) {
  const experienceLabel = input.experience === "new" ? "our new AWS experience" : "our advanced AWS experience"
  const rulesUrl =
    input.experience === "new"
      ? "https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/rules/aws-starter-rules.md"
      : "https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/rules/aws-agent-rules.md"
  const projectNote =
    input.experience === "new"
      ? `The account uses a "project". Always say "project" when talking to the user.`
      : ""
  return [
    `Connect AWS for CloudPilot by running the official Agent Toolkit setup yourself.`,
    ``,
    `Inputs already collected in the UI, do not re-ask unless a value is invalid: profile_name=${input.profile}, region=${input.region}, AWS experience=${experienceLabel}. ${projectNote}`,
    `If a value is invalid, ask with the question tool, then continue. Never ask for access keys or secret keys.`,
    `Credentials from "aws login" are valid for 12 hours and renewable for 90 days without browser re-auth.`,
    ``,
    `Safety rules: explain each step plus which tool you call before running it. One step at a time, verify before continuing.`,
    `Piped installers (curl|bash, irm|iex) and the interactive wizard need explicit user confirmation first; offer the inspect-first alternative from https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html.`,
    `Pause for the human on "aws login" (browser) and "aws configure agent-toolkit" (wizard); they may cancel at any time. Stop on failure, fetch https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup-troubleshooting.md with webfetch, apply the matching fix, then resume at that step.`,
    `CloudPilot MCP config only: connection status is "cloudpilot mcp list" showing aws-mcp connected. "aws configure agent-toolkit" does NOT know CloudPilot - it writes to opencode.json, ~/.claude.json, ~/.cursor/mcp.json, etc. Do NOT treat those files as success and do NOT stop after editing them. You must register aws-mcp with CloudPilot via "cloudpilot mcp add" below.`,
    `Edit files only with read-then-write, merge only: shell rc gets one PATH line, each aws-mcp entry only gains env.AWS_MCP_PROXY_PROFILES="<profile>" (use that var, not AWS_PROFILE), project rules are appended under <!-- BEGIN AWS Agent Toolkit rules --> markers (replace inside markers if present, never overwrite). Back up nothing destructive; report full error output and stop on unknown errors.`,
    ``,
    `Step 0 (pre-check, read-only, before changing anything): in parallel check "aws --version", "aws sts get-caller-identity --profile ${input.profile}", "cloudpilot mcp list" showing aws-mcp connected with env AWS_MCP_PROXY_PROFILES containing ${input.profile}, and "aws agent-toolkit list-available-skills --region us-east-1 --profile ${input.profile}". If all four pass, just write the marker file below, report AWS is already connected, and STOP without reinstalling or editing anything. SKIP every step that already passes: do not reinstall the CLI when "aws --version" works, do not re-run "aws login" when sts succeeds, do not re-run agent-toolkit/MCP/rules when they already pass.`,
    ``,
    `Steps: 1) Detect OS (uname -s / $env:OS). Ensure curl/PowerShell and uv exist; install uv only if missing (curl -LsSf https://astral.sh/uv/install.sh | sh, or irm https://astral.sh/uv/install.ps1 | iex). Check https://awscli.amazonaws.com reachable.`,
    `2) "aws --version"; install AWS CLI v2 only if missing (macOS/Linux: curl -fsSL 'https://awscli.amazonaws.com/v2/install.sh' | bash then PATH persist; Windows: irm 'https://awscli.amazonaws.com/v2/install.ps1' | iex).`,
    `3) "aws configure set region ${input.region} --profile ${input.profile}" then "aws login --region ${input.region} --profile ${input.profile}" and wait.`,
    `4) Verify: "aws sts get-caller-identity --profile ${input.profile}" must return AccountId/Arn/UserId; capture the AccountId.`,
    `5) Check "aws agent-toolkit list-available-skills --region us-east-1 --profile ${input.profile}". If it already returns JSON skills, SKIP "aws configure agent-toolkit" entirely (already installed, no heavy work). Only if skills check fails, run "aws configure agent-toolkit --yes --region us-east-1 --profile ${input.profile}" (us-east-1 is required here regardless of user region) for skills only. Then register aws-mcp with CloudPilot (non-interactive): "cloudpilot mcp add aws-mcp --env AWS_MCP_PROXY_PROFILES=${input.profile} -- uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp --metadata AWS_REGION=${input.region}". If an aws-mcp entry already exists in CloudPilot config, only merge the env var, leaving command/args/timeout untouched.`,
    `6) Verify: "cloudpilot mcp list" must show aws-mcp connected, plus "aws agent-toolkit list-available-skills --region us-east-1 --profile ${input.profile}" must return JSON skills.`,
    `7) Only if no rules file already contains "<!-- BEGIN AWS Agent Toolkit rules -->": fetch rules from ${rulesUrl} and append under those markers without destroying content. If markers already present, SKIP fetching entirely. End with: Setup is complete! Close this session and start a new one. Try: Please make a single page webapp game and deploy it to AWS.`,
    ``,
    `After step 6 succeeds: write the marker to BOTH paths so the TUI finds it on any platform (create parent dirs as needed): (1) unix primary "\${XDG_CONFIG_HOME:-$HOME/.config}/cloudpilot/cloud-providers.json" (also ~/.config/cloudpilot/cloud-providers.json), (2) windows "$env:APPDATA\\cloudpilot\\cloud-providers.json". Read the first path that exists (treat missing as {}), merge in {"aws": {"connected": true, "profile": "${input.profile}", "region": "${input.region}", "verifiedAt": "<now ISO>", "accountId": "<from step 4>"}} preserving other providers, and write the SAME merged JSON to both paths. Then report completion.`,
  ].join("\n")
}

// Fast path: session expired (12h) but CLI + MCP + skills + rules already exist.
// Only re-authenticate, no installs, no toolkit, no MCP add, no rules fetch.
function buildAwsReauthPrompt(input: { profile: string; region: string }) {
  return [
    `Re-authenticate AWS for CloudPilot (fast path, no heavy work).`,
    ``,
    `Inputs already collected, do not re-ask: profile_name=${input.profile}, region=${input.region}. Never ask for access keys or secret keys.`,
    `CloudPilot MCP config only: "cloudpilot mcp list" showing aws-mcp connected is the source of truth. Do NOT edit opencode.json, ~/.claude.json, ~/.cursor/mcp.json, etc.`,
    ``,
    `Safety rules: explain each step plus which tool you call before running it. One step at a time. Pause for the human on "aws login" (browser); they may cancel at any time. Stop on unknown errors and report full output.`,
    `FORBIDDEN on this path: installing uv, installing AWS CLI, running "aws configure agent-toolkit", running "cloudpilot mcp add" when aws-mcp already exists, fetching rules files. SKIP all of those - they are already done.`,
    ``,
    `Steps: 1) Run "aws sts get-caller-identity --profile ${input.profile}". If it returns AccountId/Arn/UserId, capture AccountId, skip to step 3.`,
    `2) Only if step 1 fails: run "aws configure set region ${input.region} --profile ${input.profile}" then "aws login --region ${input.region} --profile ${input.profile}" and wait. Then re-run "aws sts get-caller-identity --profile ${input.profile}" to capture AccountId.`,
    `3) Verify: "cloudpilot mcp list" shows aws-mcp connected. If missing (unexpected on this path), run once: "cloudpilot mcp add aws-mcp --env AWS_MCP_PROXY_PROFILES=${input.profile} -- uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp --metadata AWS_REGION=${input.region}". Otherwise do nothing.`,
    ``,
    `After step 3 succeeds: write the marker to BOTH paths so the TUI finds it on any platform (create parent dirs as needed): (1) unix primary "\${XDG_CONFIG_HOME:-$HOME/.config}/cloudpilot/cloud-providers.json" (also ~/.config/cloudpilot/cloud-providers.json), (2) windows "$env:APPDATA\\cloudpilot\\cloud-providers.json". Read the first path that exists (treat missing as {}), merge in {"aws": {"connected": true, "profile": "${input.profile}", "region": "${input.region}", "verifiedAt": "<now ISO>", "accountId": "<from sts>"}} preserving other providers, and write the SAME merged JSON to both paths. Then report "Re-auth complete" and STOP.`,
  ].join("\n")
}

// Repair path: marker exists but aws-mcp missing from CloudPilot.
// Only re-register MCP, no toolkit, no rules fetch, no installs.
function buildAwsRepairPrompt(input: { profile: string; region: string }) {
  return [
    `Repair AWS for CloudPilot (MCP missing, no heavy work).`,
    ``,
    `Inputs already collected, do not re-ask: profile_name=${input.profile}, region=${input.region}. Never ask for access keys or secret keys.`,
    `CloudPilot MCP config only: use "cloudpilot mcp add/list". Do NOT treat opencode.json or other tools' files as success.`,
    ``,
    `Safety rules: explain each step plus which tool you call before running it. One step at a time. Pause for the human on "aws login" (browser) only if sts fails.`,
    `FORBIDDEN on this path: installing uv, installing AWS CLI, running "aws configure agent-toolkit", fetching rules files. SKIP all of those.`,
    ``,
    `Steps: 1) Run "aws sts get-caller-identity --profile ${input.profile}". If it fails, run "aws login --region ${input.region} --profile ${input.profile}" and wait, then re-verify sts and capture AccountId.`,
    `2) Register aws-mcp with CloudPilot (non-interactive): "cloudpilot mcp add aws-mcp --env AWS_MCP_PROXY_PROFILES=${input.profile} -- uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp --metadata AWS_REGION=${input.region}". If an aws-mcp entry already exists, only merge the env var, leaving command/args/timeout untouched.`,
    `3) Verify: "cloudpilot mcp list" must show aws-mcp connected.`,
    ``,
    `After step 3 succeeds: write the marker to BOTH paths so the TUI finds it on any platform (create parent dirs as needed): (1) unix primary "\${XDG_CONFIG_HOME:-$HOME/.config}/cloudpilot/cloud-providers.json" (also ~/.config/cloudpilot/cloud-providers.json), (2) windows "$env:APPDATA\\cloudpilot\\cloud-providers.json". Read the first path that exists (treat missing as {}), merge in {"aws": {"connected": true, "profile": "${input.profile}", "region": "${input.region}", "verifiedAt": "<now ISO>", "accountId": "<from step 1>"}} preserving other providers, and write the SAME merged JSON to both paths. Then report "Repair complete" and STOP.`,
  ].join("\n")
}

function buildAwsConnectPrompt(input: { profile: string; region: string; experience: "new" | "advanced" }) {
  return buildAwsFreshPrompt(input)
}

function buildOracleConnectPrompt(input: { profile: string; region: string; tenancy: string }) {
  return [
    `Connect Oracle Cloud for CloudPilot by running the official Oracle MCP setup yourself (source: https://github.com/oracle/mcp and https://oracle-mcp.mintlify.app/quickstart).`,
    ``,
    `Inputs already collected in the UI, do not re-ask unless a value is invalid: OCI profile=${input.profile}, region=${input.region}, tenancy name=${input.tenancy}.`,
    `If a value is invalid, ask with the question tool, then continue. Never ask for private keys or API key secrets; session-token auth opens a browser flow instead.`,
    ``,
    `Safety rules: explain each step plus which tool you call before running it. One step at a time, verify before continuing.`,
    `Piped installers (curl|sh, irm|iex) need explicit user confirmation first.`,
    `Pause for the human on "oci session authenticate" (browser); they may cancel at any time. Stop on failure, fetch the troubleshooting section of https://github.com/oracle/mcp with webfetch, apply the matching fix, then resume at that step.`,
    `Use least privilege: session auth inherits the user's OCI IAM permissions, do not create API keys or broaden policies. Edit files only with read-then-write, merge only; report full error output and stop on unknown errors.`,
    ``,
    `Step 0 (pre-check, read-only, before changing anything): check "oci --version", "oci session validate --profile ${input.profile}", and "cloudpilot mcp list" showing oracle-mcp connected. If all pass, just write the marker file below, report Oracle Cloud is already connected, and STOP without reinstalling or editing anything. If only later steps fail, resume from the first failing step; do not reinstall the CLI when "oci --version" works and do not re-run session authenticate when validate succeeds.`,
    ``,
    `Steps: 1) Detect OS (uname -s / $env:OS). Ensure uv exists ("uv --version"); install uv only if missing (macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh; Windows: irm https://astral.sh/uv/install.ps1 | iex). Ensure Python 3.13 is available ("uv python install 3.13" only if missing).`,
    `2) "oci --version"; install the OCI CLI only if missing, following the Installation page linked from https://github.com/oracle/mcp.`,
    `3) Run "oci session authenticate --region ${input.region} --tenancy-name ${input.tenancy} --profile-name ${input.profile}" and wait for the human to finish the browser flow.`,
    `4) Verify: "oci session validate --profile ${input.profile}" must succeed, plus a read-only smoke test "oci iam compartment list --profile ${input.profile}".`,
    `5) Register the recommended general-purpose server with CloudPilot (non-interactive): "cloudpilot mcp add oracle-mcp --env OCI_CONFIG_PROFILE=${input.profile} -- uvx oracle.oci-cloud-mcp-server@latest". If an oracle-mcp entry already exists, only merge the env var, leaving command/args/timeout untouched.`,
    `6) Verify: "cloudpilot mcp list" must show oracle-mcp connected. End with: Setup is complete! Close this session and start a new one. Try: List my OCI compartments.`,
    ``,
    `After step 6 succeeds: resolve the global config dir (unix: echo "\${XDG_CONFIG_HOME:-$HOME/.config}/cloudpilot/cloud-providers.json", windows: $env:APPDATA\\cloudpilot\\cloud-providers.json), read that JSON (treat missing as {}), merge in {"oracle": {"connected": true, "profile": "${input.profile}", "region": "${input.region}", "verifiedAt": "<now ISO>"}} preserving other providers, and write it back. Then report completion.`,
  ].join("\n")
}

function buildGoogleConnectPrompt(input: { project: string; region: string }) {
  return [
    `Connect Google Cloud for CloudPilot by running the official gcloud MCP setup yourself (source: https://github.com/googleapis/gcloud-mcp).`,
    ``,
    `Inputs already collected in the UI, do not re-ask unless a value is invalid: project=${input.project}, region=${input.region}.`,
    `If a value is invalid, ask with the question tool, then continue. Never ask for service-account keys; browser login plus application-default login is the auth path.`,
    `The gcloud MCP server inherits the permissions of the active gcloud account; operate with least privilege.`,
    ``,
    `Safety rules: explain each step plus which tool you call before running it. One step at a time, verify before continuing.`,
    `Downloading installers needs explicit user confirmation first.`,
    `Pause for the human on "gcloud auth login" and "gcloud auth application-default login" (browser); they may cancel at any time. Stop on failure, fetch the troubleshooting section of https://github.com/googleapis/gcloud-mcp with webfetch, apply the matching fix, then resume at that step.`,
    `Edit files only with read-then-write, merge only; report full error output and stop on unknown errors.`,
    ``,
    `Step 0 (pre-check, read-only, before changing anything): check "gcloud --version", "gcloud auth list" showing an active account, "gcloud config get project" returning ${input.project}, and "cloudpilot mcp list" showing gcloud-mcp connected. If all pass, just write the marker file below, report Google Cloud is already connected, and STOP without reinstalling or editing anything. If only later steps fail, resume from the first failing step; do not reinstall the CLI when "gcloud --version" works and do not re-run auth when an active account exists.`,
    ``,
    `Steps: 1) Detect OS (uname -s / $env:OS). Ensure Node.js 20+ exists ("node --version"); install the LTS release only if missing (https://nodejs.org, or the OS package manager with user confirmation).`,
    `2) "gcloud --version"; install the Google Cloud CLI only if missing (https://cloud.google.com/sdk/docs/install).`,
    `3) Run "gcloud auth login" and wait for the human to finish the browser flow. Then run "gcloud auth application-default login" and wait again.`,
    `4) Run "gcloud config set project ${input.project}" then verify "gcloud projects describe ${input.project}" succeeds. Optionally "gcloud config set compute/region ${input.region}".`,
    `5) Register the server with CloudPilot (non-interactive): "cloudpilot mcp add gcloud-mcp -- npx -y @google-cloud/gcloud-mcp". If a gcloud-mcp entry already exists, leave command/args/timeout untouched.`,
    `6) Verify: "cloudpilot mcp list" must show gcloud-mcp connected. End with: Setup is complete! Close this session and start a new one. Try: List my Google Cloud projects.`,
    ``,
    `After step 6 succeeds: resolve the global config dir (unix: echo "\${XDG_CONFIG_HOME:-$HOME/.config}/cloudpilot/cloud-providers.json", windows: $env:APPDATA\\cloudpilot\\cloud-providers.json), read that JSON (treat missing as {}), merge in {"google-cloud": {"connected": true, "project": "${input.project}", "region": "${input.region}", "verifiedAt": "<now ISO>"}} preserving other providers, and write it back. Then report completion.`,
  ].join("\n")
}

function buildAzureConnectPrompt(input: { location: string }) {
  return [
    `Connect Microsoft Azure for CloudPilot by running the official Azure MCP setup yourself (source: https://github.com/microsoft/mcp/blob/main/servers/Azure.Mcp.Server/README.md).`,
    ``,
    `Input already collected in the UI, do not re-ask unless invalid: location=${input.location}. The subscription is NOT pre-collected: discover it after login (step 3) and if several subscriptions exist, ask the user which to use with the question tool.`,
    `Never ask for client secrets or certificates; "az login" browser/device-code flow is the auth path.`,
    ``,
    `Safety rules: explain each step plus which tool you call before running it. One step at a time, verify before continuing.`,
    `Downloading installers needs explicit user confirmation first.`,
    `Pause for the human on "az login" (browser); they may cancel at any time. Stop on failure, fetch the troubleshooting guide from https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/ with webfetch, apply the matching fix, then resume at that step.`,
    `Edit files only with read-then-write, merge only; report full error output and stop on unknown errors.`,
    ``,
    `Step 0 (pre-check, read-only, before changing anything): check "az --version", "az account show" succeeding, and "cloudpilot mcp list" showing azure-mcp connected. If all pass, just write the marker file below, report Azure is already connected, and STOP without reinstalling or editing anything. If only later steps fail, resume from the first failing step; do not reinstall the CLI when "az --version" works and do not re-run "az login" when "az account show" succeeds.`,
    ``,
    `Steps: 1) Detect OS (uname -s / $env:OS). Ensure Node.js LTS exists ("node --version"); install it only if missing (https://nodejs.org, or the OS package manager with user confirmation).`,
    `2) "az --version"; install the Azure CLI only if missing (https://learn.microsoft.com/en-us/cli/azure/install-azure-cli).`,
    `3) Run "az login" and wait for the human to finish the browser flow. Then "az account show": capture the subscription id and name. If multiple subscriptions are enabled, ask which to use, then "az account set --subscription <id>".`,
    `4) Register the server with CloudPilot (non-interactive): "cloudpilot mcp add azure-mcp -- npx -y @azure/mcp@latest server start". If an azure-mcp entry already exists, leave command/args/timeout untouched.`,
    `5) Verify: "cloudpilot mcp list" must show azure-mcp connected, plus a read-only smoke test "az group list". End with: Setup is complete! Close this session and start a new one. Try: List my Azure resource groups.`,
    ``,
    `After step 5 succeeds: resolve the global config dir (unix: echo "\${XDG_CONFIG_HOME:-$HOME/.config}/cloudpilot/cloud-providers.json", windows: $env:APPDATA\\cloudpilot\\cloud-providers.json), read that JSON (treat missing as {}), merge in {"azure": {"connected": true, "location": "${input.location}", "subscriptionId": "<from step 3>", "verifiedAt": "<now ISO>"}} preserving other providers, and write it back. Then report completion.`,
  ].join("\n")
}

export function DialogCloudProvider(props: { promptRef?: { current: PromptRef | undefined } }) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const sync = useSync()
  const sdk = useSDK()
  const [status] = createResource(readCloudProviderStatus)
  const markerConnected = (id: string) => status()?.[id]?.connected === true
  const mcpConnected = (name: string) => sync.data.mcp[name]?.status === "connected"
  const connected = (id: string) => markerConnected(id) || (id in MCP_NAME && mcpConnected(MCP_NAME[id as keyof typeof MCP_NAME]))

  async function refreshMcpStatus() {
    try {
      const res = await sdk.client.mcp.status()
      if (res.data) sync.set("mcp", res.data)
    } catch {
      // Fail open: stale MCP state must not block an explicit Connect.
    }
  }

  async function askValidated(input: {
    title: string
    placeholder: string
    description: string
    pattern: RegExp
    error: string
  }): Promise<string | null> {
    for (;;) {
      const value = await DialogPrompt.show(dialog, input.title, {
        placeholder: input.placeholder,
        description: () => <text>{input.description}</text>,
      })
      if (value === null) return null
      const trimmed = value.trim()
      if (input.pattern.test(trimmed)) return trimmed
      toast.show({ variant: "error", message: input.error })
    }
  }

  async function askExperience(): Promise<"new" | "advanced" | null> {
    return new Promise((resolve) => {
      dialog.replace(
        () => (
          <DialogSelect
            title="Which AWS experience are you using?"
            options={[
              {
                title: "New experience",
                value: "new",
                description: "Signed up with Google/GitHub, have a project",
              },
              {
                title: "Advanced experience",
                value: "advanced",
                description: "Standard AWS account and region",
              },
            ]}
            onSelect={(option) => resolve(option.value as "new" | "advanced")}
          />
        ),
        () => resolve(null),
      )
    })
  }

  async function askProfile(): Promise<string | null> {
    return askValidated({
      title: "AWS profile name",
      placeholder: "my-profile",
      description: "Profile name for AWS CLI credentials.",
      pattern: PROFILE_PATTERN,
      error: "Profile must start with a letter/number and use only letters, numbers, hyphens, underscores.",
    })
  }

  async function askRegion(): Promise<string | null> {
    return askValidated({
      title: "AWS region",
      placeholder: "us-east-1",
      description: "Default region for your account or project.",
      pattern: REGION_PATTERN,
      error: "Region looks like us-east-1 or eu-west-1.",
    })
  }

  async function beginAgentSetup(title: string, prompt: string) {
    const ref = props.promptRef?.current
    if (!ref) {
      toast.show({ message: "Open a session first, then try Connect again.", variant: "error" })
      dialog.clear()
      return
    }
    ref.set({ input: prompt, parts: [] })
    dialog.clear()
    toast.show({ title, message: "The agent will run the steps in this session.", variant: "info" })
    ref.submit()
  }

  async function connectAws() {
    await refreshMcpStatus()
    const saved = status()?.aws
    const markerConnected = saved?.connected === true
    const mcpOk = mcpConnected(MCP_NAME.aws)
    const mode = getAwsConnectionMode({ markerConnected, mcpConnected: mcpOk })
    if (mode === "reauth") {
      const profile = saved?.profile ?? (await askProfile())
      if (!profile) {
        dialog.clear()
        return
      }
      const region = saved?.region ?? (await askRegion())
      if (!region) {
        dialog.clear()
        return
      }
      await beginAgentSetup("Re-authenticating AWS", buildAwsReauthPrompt({ profile, region }))
      return
    }
    if (mode === "repair") {
      const profile = saved?.profile ?? (await askProfile())
      if (!profile) {
        dialog.clear()
        return
      }
      const region = saved?.region ?? (await askRegion())
      if (!region) {
        dialog.clear()
        return
      }
      await beginAgentSetup("Repairing AWS connection", buildAwsRepairPrompt({ profile, region }))
      return
    }
    const profile = await askProfile()
    if (!profile) {
      dialog.clear()
      return
    }
    const region = await askRegion()
    if (!region) {
      dialog.clear()
      return
    }
    const experience = await askExperience()
    if (!experience) {
      dialog.clear()
      return
    }
    await beginAgentSetup("Starting AWS setup", buildAwsFreshPrompt({ profile, region, experience }))
  }

  async function connectOracle() {
    await refreshMcpStatus()
    if (mcpConnected(MCP_NAME.oracle)) {
      toast.show({ title: "Oracle Cloud", message: "Oracle MCP is already connected.", variant: "success" })
      dialog.clear()
      return
    }
    const profile = await askValidated({
      title: "OCI profile name",
      placeholder: "DEFAULT",
      description: "Profile name for OCI CLI credentials.",
      pattern: PROFILE_PATTERN,
      error: "Profile must start with a letter/number and use only letters, numbers, hyphens, underscores.",
    })
    if (!profile) {
      dialog.clear()
      return
    }
    const region = await askValidated({
      title: "OCI region",
      placeholder: "us-ashburn-1",
      description: "Home region of your tenancy.",
      pattern: REGION_PATTERN,
      error: "Region looks like us-ashburn-1 or eu-frankfurt-1.",
    })
    if (!region) {
      dialog.clear()
      return
    }
    const tenancy = await askValidated({
      title: "OCI tenancy name",
      placeholder: "my-tenancy",
      description: "Tenancy name shown in the OCI console.",
      pattern: NON_BLANK_PATTERN,
      error: "Tenancy name can't be blank.",
    })
    if (!tenancy) {
      dialog.clear()
      return
    }
    await beginAgentSetup("Starting Oracle Cloud setup", buildOracleConnectPrompt({ profile, region, tenancy }))
  }

  async function connectGoogleCloud() {
    await refreshMcpStatus()
    if (mcpConnected(MCP_NAME["google-cloud"])) {
      toast.show({ title: "Google Cloud", message: "Google Cloud MCP is already connected.", variant: "success" })
      dialog.clear()
      return
    }
    const project = await askValidated({
      title: "Google Cloud project ID",
      placeholder: "my-project-123456",
      description: "Project ID to use with gcloud.",
      pattern: GCP_PROJECT_PATTERN,
      error: "Project ID is 6-30 lowercase letters, digits, hyphens; starts with a letter.",
    })
    if (!project) {
      dialog.clear()
      return
    }
    const region = await askValidated({
      title: "Google Cloud region",
      placeholder: "us-central1",
      description: "Default region for deployments.",
      pattern: GCP_REGION_PATTERN,
      error: "Region looks like us-central1 or europe-west1.",
    })
    if (!region) {
      dialog.clear()
      return
    }
    await beginAgentSetup("Starting Google Cloud setup", buildGoogleConnectPrompt({ project, region }))
  }

  async function connectAzure() {
    await refreshMcpStatus()
    if (mcpConnected(MCP_NAME.azure)) {
      toast.show({ title: "Microsoft Azure", message: "Azure MCP is already connected.", variant: "success" })
      dialog.clear()
      return
    }
    const location = await askValidated({
      title: "Azure location",
      placeholder: "eastus",
      description: "Default location for deployments.",
      pattern: AZURE_LOCATION_PATTERN,
      error: "Location looks like eastus or westeurope (lowercase, no spaces).",
    })
    if (!location) {
      dialog.clear()
      return
    }
    await beginAgentSetup("Starting Azure setup", buildAzureConnectPrompt({ location }))
  }

  return (
    <DialogSelect
      title="Select cloud service provider"
      options={CLOUD_PROVIDERS.map((item) => {
        const isConnected = connected(item.value)
        return {
          ...item,
          gutter: isConnected ? () => <text fg={theme.success}>✓</text> : () => <text fg={theme.info}>☁</text>,
          footer: <Status connected={isConnected} />,
        }
      })}
      onSelect={(option) => {
        if (option.value === "aws") return void connectAws()
        if (connected(option.value)) {
          toast.show({ title: option.title, message: "Already connected.", variant: "success" })
          dialog.clear()
          return
        }
        if (option.value === "oracle") return void connectOracle()
        if (option.value === "google-cloud") return void connectGoogleCloud()
        if (option.value === "azure") return void connectAzure()
        toast.show({ title: `Selected ${option.title}`, message: "Connection not configured yet.", variant: "info" })
        dialog.clear()
      }}
    />
  )
}

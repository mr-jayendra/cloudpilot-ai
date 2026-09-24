/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { detectApp } from "./_lib/detect"
import { PROVIDERS, assertEnabled } from "./_lib/providers"
import { initSteps, loadState, log, newState, recordApproval, saveState } from "./_lib/state"

const STEP_TEMPLATE = [
  { id: "analyze", label: "Analyze project" },
  { id: "requirements", label: "Generate cloud requirements report" },
  { id: "human_review_requirements", label: "Human review: requirements report" },
  { id: "validate_credentials", label: "Check provider connection (CLI/MCP)" },
  { id: "plan", label: "Generate deployment plan" },
  { id: "human_review_plan", label: "Human review: deployment plan" },
  { id: "provision", label: "Provision infrastructure (via MCP/CLI)" },
  { id: "human_review_provision", label: "Human review: infrastructure changes" },
  { id: "configure", label: "Configure server" },
  { id: "deploy_app", label: "Deploy application" },
  { id: "human_review_deploy", label: "Human review: deploy commands" },
  { id: "health_check", label: "Run health check" },
  { id: "complete", label: "Deployment complete" },
]

function targetFor(provider: string): string {
  if (provider === "oracle") return "oci-compute-vm"
  if (provider === "aws") return "aws-ec2-via-mcp"
  if (provider === "gcp") return "gcp-compute-via-mcp"
  return "azure-vm-via-mcp"
}

export default tool({
  description: `Generates a concrete deployment plan for the current project on the user-chosen provider (oracle, aws, gcp, azure) and REQUIRES the user's explicit approval before anything is provisioned.

The agent must have asked the user for the provider and any suggestions via the \`question\` tool first, and should have run deploy-analyze + deploy-requirements already -- pass the requirements deployment_id here to continue that same deployment, or omit it to start a fresh plan. After approval the agent carries out the rest via the connected MCP server / provider CLI.

Creates (or continues) a deployment record (deploymentId) that later steps (provision, deploy-app, deploy-status, ...) operate on.`,
  args: {
    provider: tool.schema.enum(["oracle", "aws", "gcp", "azure"]).default("oracle"),
    region: tool.schema.string().optional().describe("Provider region, e.g. us-ashburn-1 (oracle) or us-east-1 (aws)"),
    compartment_id: tool.schema.string().optional().describe("OCID of the OCI compartment (oracle only)"),
    app_port: tool.schema.number().optional().describe("Override the auto-detected application port"),
    deployment_id: tool.schema.string().optional().describe("Continue a deployment started by deploy-requirements; defaults to a fresh plan"),
    suggestions: tool.schema.string().optional().describe("User suggestions collected via the question tool to fold into the plan"),
  },
  async execute(args, ctx) {
    ctx.metadata({ title: "Building deployment plan" })
    assertEnabled(args.provider)
    const connection = await PROVIDERS[args.provider].status(ctx.directory)
    if (!connection.connected) {
      return {
        title: `${connection.name} not connected`,
        output: `✗ ${connection.name} is NOT connected -- ${connection.detail}\n\nNotify the user exactly what is missing and stop. Run deploy-connect first; do not proceed until the provider is connected.`,
      }
    }

    const detection = await detectApp(ctx.directory)
    if (detection.appType === "unknown") {
      return {
        title: "Cannot plan deployment",
        output:
          "The project type could not be determined automatically, so a safe deployment plan cannot be generated. Ask the user (via the question tool) what the application is (language/framework, install/start commands, and port) and re-run deploy-requirements / deploy-plan with their suggestions.",
      }
    }

    const port = args.app_port ?? detection.port ?? 8080
    const existing = args.deployment_id ? await loadState(ctx.directory, args.deployment_id) : undefined
    const state =
      existing ?? newState({ provider: args.provider as "oracle" | "aws" | "gcp" | "azure", region: args.region, compartmentId: args.compartment_id })
    state.provider = args.provider as "oracle" | "aws" | "gcp" | "azure"
    if (args.region) state.region = args.region
    if (args.compartment_id) state.compartmentId = args.compartment_id
    state.appType = detection.appType
    state.appPort = port
    state.target = targetFor(args.provider)
    initSteps(state, STEP_TEMPLATE)
    state.steps[0].status = "completed" // analyze already ran above
    state.status = "planning"

    const planSteps =
      args.provider === "oracle"
        ? ([
            `1. Create a VCN, subnet, internet gateway, and security list opening ports 22 (SSH) and ${port} (app)`,
            "2. Create a Free Tier compute instance (VM.Standard.E2.1.Micro, Canonical Ubuntu 22.04)",
            `3. Install the runtime this app needs (${detection.appType}) and any dependencies via ${detection.installCommand ?? "the appropriate package manager"}`,
            detection.buildCommand ? `4. Build the application: ${detection.buildCommand}` : undefined,
            `5. Upload the application to the instance and configure it to run as a systemd service on port ${port}`,
            `6. Start the service and run a health check against port ${port}`,
          ].filter(Boolean) as string[])
        : ([
            `1. Via the connected MCP server / ${args.provider} CLI: create network (VPC/VNet) opening ports 22 (SSH) and ${port} (app)${args.region ? ` in ${args.region}` : ""}`,
            `2. Via MCP/CLI: create a Free Tier eligible VM for a ${detection.appType} app (Ubuntu 22.04 or provider equivalent)`,
            `3. Install the runtime this app needs (${detection.appType}) and dependencies via ${detection.installCommand ?? "the appropriate package manager"}`,
            detection.buildCommand ? `4. Build the application: ${detection.buildCommand}` : undefined,
            `5. Upload the application and configure it to run as a service on port ${port}`,
            `6. Start the service and run a health check against port ${port}`,
          ].filter(Boolean) as string[])

    state.plan = {
      ...(typeof state.plan === "object" ? state.plan : {}),
      provider: args.provider,
      region: args.region,
      compartmentId: args.compartment_id,
      appType: detection.appType,
      appPort: port,
      installCommand: detection.installCommand,
      buildCommand: detection.buildCommand,
      startCommand: detection.startCommand,
      steps: planSteps,
      warnings: detection.warnings,
      suggestions: args.suggestions,
      target: state.target,
    }

    const planSummary = [
      `Deployment plan for a ${detection.appType} application on ${args.provider}:`,
      "",
      ...planSteps,
      "",
      detection.warnings.length ? `Warnings:\n${detection.warnings.map((w) => `- ${w}`).join("\n")}` : "",
      args.suggestions ? `User suggestions applied: ${args.suggestions}` : "",
      "",
      args.provider === "oracle"
        ? "Approving this will allow provisioning to create real Oracle Cloud resources (you'll be asked again, with the exact resource list, before anything is actually created)."
        : `Approving this will allow provisioning via the connected MCP server / ${args.provider} CLI (you'll be asked again, with the exact resource list, before anything is actually created).`,
    ]
      .filter(Boolean)
      .join("\n")

    log(state, "Plan generated, requesting approval")

    await ctx.ask({
      permission: "deploy_plan",
      patterns: [state.deploymentId],
      always: [],
      metadata: { planSummary, deploymentId: state.deploymentId },
    })
    // ctx.ask() rejects (throws) if the user declines -- if we reach the
    // next line, the plan was explicitly approved.

    recordApproval(state, "human_review_plan", planSummary)
    state.steps.find((s) => s.id === "human_review_plan")!.status = "completed"
    state.steps.find((s) => s.id === "plan")!.status = "completed"
    state.status = "awaiting_approval" // awaiting the *next* checkpoint (provisioning)
    await saveState(ctx.directory, state)

    return {
      title: `Plan approved: ${detection.appType} on ${args.provider}`,
      output: `${planSummary}\n\nPlan approved and saved as deployment ${state.deploymentId}. Next: provision via the connected MCP server / provider CLI, then deploy-app.`,
      metadata: { deploymentId: state.deploymentId, plan: state.plan },
    }
  },
})

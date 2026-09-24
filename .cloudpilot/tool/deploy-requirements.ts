/// <reference path="../env.d.ts" />
import { tool } from "@cloudpilot-ai/plugin"
import { detectApp } from "./_lib/detect"
import { PROVIDERS, assertEnabled } from "./_lib/providers"
import { buildRequirements } from "./_lib/requirements"
import { initSteps, log, newState, recordApproval, saveState } from "./_lib/state"

const STEP_TEMPLATE = [
  { id: "analyze", label: "Analyze project" },
  { id: "requirements", label: "Generate cloud requirements report" },
  { id: "human_review_requirements", label: "Human review: requirements report" },
  { id: "connect", label: "Check provider connection (CLI/MCP)" },
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

export default tool({
  description: `Generates a cloud-requirements report for the current project on the user-chosen provider (oracle, aws, gcp, azure) and REQUIRES explicit approval before provisioning.

Read-only until the approval checkpoint: it analyzes the project, builds the report (compute, network, storage, env, runtime, warnings), and asks for approval showing the full report. The agent should collect the provider choice and any user suggestions via the \`question\` tool first, then pass them here as provider/suggestions. If the user suggests changes, call this tool again with the updated suggestions -- nothing is provisioned until the report is approved.`,
  args: {
    provider: tool.schema.enum(["oracle", "aws", "gcp", "azure"]).describe("Cloud provider chosen by the user via the question tool"),
    region: tool.schema.string().optional().describe("Provider region, e.g. us-ashburn-1 (oracle), us-east-1 (aws)"),
    suggestions: tool.schema.string().optional().describe("User suggestions/edits to fold into the report, collected via the question tool"),
  },
  async execute(args, ctx) {
    ctx.metadata({ title: "Building requirements report" })
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
        title: "Cannot build requirements report",
        output:
          "The project type could not be determined automatically. Ask the user (via the question tool) what the application is (language/framework, install/start commands, port) and re-run deploy-requirements with their suggestions.",
      }
    }
    const report = buildRequirements({ provider: args.provider, region: args.region, detection, suggestions: args.suggestions })
    const state = newState({ provider: args.provider, region: args.region })
    state.appType = detection.appType
    state.appPort = report.appPort
    initSteps(state, STEP_TEMPLATE)
    state.steps[0].status = "completed"
    state.steps[1].status = "completed"
    state.status = "planning"
    state.plan = { requirements: report } as unknown as Record<string, unknown>
    log(state, `Requirements report generated for ${args.provider}`)
    await ctx.ask({
      permission: "deploy_requirements",
      patterns: [state.deploymentId],
      always: [],
      metadata: { reportSummary: report.summary, deploymentId: state.deploymentId },
    })
    recordApproval(state, "human_review_requirements", report.summary)
    state.steps.find((s) => s.id === "human_review_requirements")!.status = "completed"
    state.status = "awaiting_approval"
    await saveState(ctx.directory, state)
    return {
      title: `Requirements approved: ${detection.appType} on ${args.provider}`,
      output: `${report.summary}\n\nReport approved and saved as deployment ${state.deploymentId}. Next: check provider connection, then deploy-plan with deployment_id ${state.deploymentId}. After that the agent carries out the rest via the connected MCP server / provider CLI.`,
      metadata: { deploymentId: state.deploymentId, requirements: report },
    }
  },
})

# Deploy Agent

Deploys the current project to any cloud (Oracle, AWS, GCP, Azure) using natural language. The agent asks the provider via `question`, generates a requirements report for confirmation, then completes the rest via MCP.

## What this is

A primary agent (`.cloudpilot/agent/deploy.md`) plus custom tools (`.cloudpilot/tool/deploy-*.ts`), built with the project's existing custom-agent / custom-tool extension mechanism. It reuses the permission/approval system (`ctx.ask`) and live tool-output streaming (`ctx.metadata`) -- no parallel UI, database, or event system was introduced.

Select it like any other agent (`deploy` in the agent switcher / `--agent deploy`), then talk to it normally:

- "Deploy this project -- ask me which cloud to use."
- "Is this ready to deploy?"
- "What's happening right now?"
- "Check the logs."
- "Restart the app."
- "Roll back the deployment."

## Flow (safe by design)

1. Agent asks the provider + region via the `question` tool (never assumes).
2. `deploy-connect` gate: checks the chosen provider is connected. If connected, proceed; if not, notify the user exactly what is missing and stop.
3. `deploy-analyze` detects app type, commands, port (read-only, only once connected).
4. `deploy-requirements` builds a cloud-requirements report (compute, network, storage, env) and asks for approval. User can suggest edits via `question`; the tool re-runs with `suggestions` until approved. Nothing is provisioned before this. The tool also refuses to run when the provider is disconnected.
5. Connection details: oracle checks OCI CLI auth; aws/gcp/azure check the connected MCP server (see `cloudpilot.jsonc`) or provider CLI (`deploy-providers` shows status).
6. `deploy-plan` builds the concrete plan for the approved requirements (re-checks connection, approval inside the tool).
7. Provision + `deploy-app` run via MCP/CLI (oracle via OpenTofu), each with its own approval. `deploy-status` verifies with a real health check.

## One-time setup (you do this, not the agent)

The agent cannot create accounts or credentials for you. Before your first real deployment:

- **Oracle**: install OCI CLI + `oci setup config`, install OpenTofu, know compartment OCID + region, then pick `oracle` in the agent and let `deploy-connect` verify.
- **AWS/GCP/Azure**: authenticate the provider CLI (`aws configure` / `gcloud auth login` / `az login`) OR configure its MCP server in `.cloudpilot/cloudpilot.jsonc` (aws-mcp and render are already scaffolded there). Have `rsync` + `ssh` available.
- Ask `deploy-providers` at any time to see exactly what's missing -- nothing here is guessed or faked.

## What's implemented

- **Detection** (`deploy-analyze`): Node.js, Python, Go, static sites, and Docker-present projects.
- **Requirements report** (`deploy-requirements` + `_lib/requirements.ts`): pure, read-only report (compute, network, storage, env, warnings) per provider, with `suggestions` support and approval checkpoint. This is the user-editable confirmation gate.
- **Provisioning**: oracle via OpenTofu-generated VCN/subnet/security-list/instance (`VM.Standard.E2.1.Micro`, Ubuntu 22.04); aws/gcp/azure via the connected MCP server / provider CLI after the same approval (the provision tool returns the exact MCP steps; the agent executes them, never simulated).
- **App deployment** (`deploy-app`): `rsync` upload + generated `systemd` unit (`cloudpilot-app`) running the detected start command (works for any provider once the VM exists).
- **Status/health** (`deploy-status`): reads local state and performs a real SSH + `curl` health check -- never reports "running" without checking.
- **Logs** (`deploy-logs`): `journalctl` for the remote service, plus the local deployment event log.
- **Restart / rollback** (`deploy-restart`, `deploy-rollback`): both gated behind explicit approval; oracle rollback runs `tofu destroy`, other providers roll back via MCP/CLI; only ever triggered when the user asks for it.
- **Providers** (`deploy-providers`, `.cloudpilot/tool/_lib/providers.ts`): a `CloudProvider` interface with CLI-based status for all four clouds; orchestration tools never hardcode provider branches except for the oracle-Terraform path.
- **State** (`.cloudpilot/tool/_lib/state.ts`): deployment records persisted as JSON under `.cloudpilot/deploy/history/`. Nothing here touches a database.
- **Approval**: every high-impact tool (`deploy-requirements`, `deploy-plan`, provision, `deploy-app`, `deploy-restart`, `deploy-rollback`) calls `ctx.ask(...)`; the agent's permission block forces `ask` for all six, and all user info (provider, region, suggestions) is collected via the `question` tool.

## What's intentionally out of scope for this pass

- **A dedicated graphical sidebar panel**: UI clients render tool activity, `ctx.metadata` titles, and approval prompts generically for *every* agent already. `deploy-status` and `renderProcessLine()` in `_lib/state.ts` produce the same step list (✓/●/○) as plain text today.
- **Docker/Java-specific deploy paths**: `deploy-analyze` detects a Dockerfile's presence, but `deploy-app` currently only has concrete install/build/start logic for Node.js, Python, and Go. Extending it (e.g. `docker compose up -d` for Docker-detected projects) is a small, isolated addition to `deploy-app.ts` when needed.
- **Live-tested against real tenancies**: this was built by reading the target codebase's actual architecture (agent/tool loader, permission schema, `ctx.ask`/`ctx.metadata`, `question` tool, MCP config) rather than by running against real clouds. Treat first use per provider as a dry run: check `deploy-providers` output carefully, review the requirements report + plan, and review MCP/CLI actions before approving provision.

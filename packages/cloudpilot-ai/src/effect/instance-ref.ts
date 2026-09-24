import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@cloudpilot-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~cloudpilot/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~cloudpilot/WorkspaceRef", {
  defaultValue: () => undefined,
})

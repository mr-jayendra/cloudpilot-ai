import { run as runTui, type TuiInput } from "@cloudpilot-ai/tui"
import { Global } from "@cloudpilot-ai/core/global"
import { AppNodeBuilder } from "@cloudpilot-ai/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}

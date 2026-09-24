/// <reference path="../markdown.d.ts" />

export * as SkillPlugin from "./skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import customizeCloudpilotContent from "./skill/customize-cloudpilot.md" with { type: "text" }

export const CustomizeCloudpilotContent = customizeCloudpilotContent

export const Plugin = define({
  id: "skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "customize-cloudpilot",
            description:
              "Use ONLY when the user is editing or creating cloudpilot's own configuration: cloudpilot.json, cloudpilot.jsonc, files under .cloudpilot/, or files under ~/.config/cloudpilot/. Also use when creating or fixing cloudpilot agents, subagents, commands, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring cloudpilot itself.",
            location: AbsolutePath.make("/builtin/customize-cloudpilot.md"),
            content: CustomizeCloudpilotContent,
          }),
        }),
      )
    })
  }),
})

import { AgentV2 } from "@cloudpilot-ai/core/agent"
import { AISDK } from "@cloudpilot-ai/core/aisdk"
import { Catalog } from "@cloudpilot-ai/core/catalog"
import { CommandV2 } from "@cloudpilot-ai/core/command"
import { Credential } from "@cloudpilot-ai/core/credential"
import { AppNodeBuilder } from "@cloudpilot-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@cloudpilot-ai/core/effect/app-node-platform"
import { LayerNode } from "@cloudpilot-ai/core/effect/layer-node"
import { EventV2 } from "@cloudpilot-ai/core/event"
import { FileSystem } from "@cloudpilot-ai/core/filesystem"
import { FSUtil } from "@cloudpilot-ai/core/fs-util"
import { Integration } from "@cloudpilot-ai/core/integration"
import { Location } from "@cloudpilot-ai/core/location"
import { Npm } from "@cloudpilot-ai/core/npm"
import { PluginV2 } from "@cloudpilot-ai/core/plugin"
import { Reference } from "@cloudpilot-ai/core/reference"
import { SkillV2 } from "@cloudpilot-ai/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)

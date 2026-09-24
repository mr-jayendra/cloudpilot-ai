import { CloudProvider } from "@cloudpilot-ai/schema/cloud-provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

const all: ReadonlyArray<typeof CloudProvider.Info.Type> = [
  { id: CloudProvider.ID.make("aws"), name: "AWS", description: "Amazon Web Services" },
  { id: CloudProvider.ID.make("oracle"), name: "Oracle Cloud", description: "Oracle Cloud Infrastructure" },
  {
    id: CloudProvider.ID.make("google-cloud"),
    name: "Google Cloud",
    description: "Google Cloud Platform",
  },
  { id: CloudProvider.ID.make("azure"), name: "Microsoft Azure", description: "Microsoft Azure" },
]

export const CloudProviderHandler = HttpApiBuilder.group(Api, "server.cloud-provider", (handlers) =>
  handlers.handle("cloud-provider.list", () =>
    Effect.gen(function* () {
      return yield* response(Effect.succeed(all))
    }),
  ),
)

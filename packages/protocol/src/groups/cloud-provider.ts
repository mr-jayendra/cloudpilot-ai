import { CloudProvider } from "@cloudpilot-ai/schema/cloud-provider"
import { Location } from "@cloudpilot-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const CloudProviderGroup = HttpApiGroup.make("server.cloud-provider")
  .add(
    HttpApiEndpoint.get("cloud-provider.list", "/api/cloud-provider", {
      query: LocationQuery,
      success: Location.response(Schema.Array(CloudProvider.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.cloud-provider.list",
          summary: "List cloud service providers",
          description: "Retrieve configured cloud service providers such as AWS, Oracle, and Google Cloud.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "cloud-providers",
      description: "Experimental cloud service provider routes.",
    }),
  )

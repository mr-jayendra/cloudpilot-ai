export * from "./client.js"
export * from "./server.js"

import { createCloudpilotClient } from "./client.js"
import { createCloudpilotServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createCloudpilot(options?: ServerOptions) {
  const server = await createCloudpilotServer({
    ...options,
  })

  const client = createCloudpilotClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}

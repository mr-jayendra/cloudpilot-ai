// @ts-nocheck

import { CloudPilot } from "@cloudpilot-ai/core"
import { ReadTool } from "@cloudpilot-ai/core/tools"

const cloudpilot = CloudPilot.make({})

cloudpilot.tool.add(ReadTool)

cloudpilot.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

cloudpilot.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

cloudpilot.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await cloudpilot.session.create({
  agent: "build",
})

cloudpilot.subscribe((event) => {
  console.log(event)
})

await cloudpilot.session.prompt({
  sessionID,
  text: "hey what is up",
})

await cloudpilot.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await cloudpilot.session.wait()

console.log(await cloudpilot.session.messages(sessionID))

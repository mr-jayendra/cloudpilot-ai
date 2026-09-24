import { EOL } from "os"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"

const all = [
  { id: "aws", name: "AWS", description: "Amazon Web Services" },
  { id: "oracle", name: "Oracle Cloud", description: "Oracle Cloud Infrastructure" },
  { id: "google-cloud", name: "Google Cloud", description: "Google Cloud Platform" },
  { id: "azure", name: "Microsoft Azure", description: "Microsoft Azure" },
]

const CloudProviderListCommand = effectCmd({
  command: "list",
  aliases: ["ls"],
  describe: "list cloud service providers",
  instance: false,
  handler: Effect.fn("Cli.cloud-provider.list")(function* () {
    for (const provider of all) {
      process.stdout.write(`${provider.id} (${provider.name})` + EOL)
      process.stdout.write(`  ${provider.description}` + EOL)
    }
  }),
})

export const CloudProviderCommand = cmd({
  command: "cloud-provider",
  aliases: ["cloud-providers", "cloud"],
  describe: "manage cloud service providers",
  builder: (yargs) => yargs.command(CloudProviderListCommand).demandCommand(),
  async handler() {},
})

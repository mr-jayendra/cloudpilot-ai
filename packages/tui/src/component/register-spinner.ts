import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerCloudpilotSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}

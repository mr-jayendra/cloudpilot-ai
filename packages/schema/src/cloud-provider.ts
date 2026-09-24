export * as CloudProvider from "./cloud-provider"

import { Schema } from "effect"
import { optional } from "./schema"

export const ID = Schema.String.pipe(Schema.brand("CloudProvider.ID"))
export type ID = typeof ID.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  name: Schema.String,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "CloudProvider.Info" })

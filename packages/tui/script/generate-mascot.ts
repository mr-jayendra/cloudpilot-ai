// Regenerates `src/mascot/cells.ts` from the root `cloudpilot_logo.png`.
//
// Run from `packages/tui`: `bun script/generate-mascot.ts`
//
// The PNG is only read here at build time. The TUI runtime renders the
// checked-in cells with ordinary text cells, so the installed binary never
// loads image bytes and needs no terminal image protocol.
import { rasterizePng } from "../src/mascot/raster"

const widths = [12, 20, 28, 36, 44]

const pngUrl = new URL("../../../cloudpilot_logo.png", import.meta.url)
const buffer = new Uint8Array(await Bun.file(pngUrl).arrayBuffer())

const entries = widths.map((width) => {
  const cells = rasterizePng(buffer, width)
  console.log(`width ${width}: ${cells.length} rows x ${cells[0]?.length ?? 0} cols`)
  return `  ${width}: ${JSON.stringify(cells)}`
})

const output = `// GENERATED from cloudpilot_logo.png - do not edit by hand.
// Regenerate with: bun script/generate-mascot.ts (run from packages/tui)
// Rendered with ordinary terminal cells (" ", "\u2580", "\u2584"); no Kitty,
// Sixel, or iTerm2 image protocol is used or needed.
import type { MascotCell } from "./raster"

export const mascotCellWidths = [${widths.join(", ")}] as const

export const mascotCells: Record<number, MascotCell[][]> = {
${entries.join(",\n")},
}

export * as MascotCells from "./cells"
`

await Bun.write(new URL("../src/mascot/cells.ts", import.meta.url), output)
console.log("wrote src/mascot/cells.ts")

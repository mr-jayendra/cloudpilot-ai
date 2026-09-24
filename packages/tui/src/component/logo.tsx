import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { mascotCellWidths, mascotCells } from "../mascot/cells"
import { CellImage } from "./image"

// Rows (prompt, taglines, gaps, margins) the mascot must leave room for so
// it never pushes the prompt outside small terminals.
const RESERVED_ROWS = 14
const SOURCE_RATIO = 1024 / 1536

// Largest pre-rasterized width that fits both dimensions. Falls back to the
// smallest art on extremely narrow or short terminals instead of breaking
// the layout.
export function pickMascotWidth(termWidth: number, termHeight: number): number {
  const byWidth = termWidth >= 64 ? 44 : termWidth >= 52 ? 36 : termWidth >= 40 ? 28 : termWidth >= 28 ? 20 : 12
  const maxRows = Math.max(4, termHeight - RESERVED_ROWS)
  let picked: number = mascotCellWidths[0] ?? 12
  for (const width of mascotCellWidths) {
    if (width > byWidth) break
    if (Math.ceil((width * SOURCE_RATIO) / 2) > maxRows) break
    picked = width
  }
  return picked
}

export function Logo() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const cells = () => mascotCells[pickMascotWidth(dimensions().width, dimensions().height)] ?? []

  return (
    <box flexDirection="column" gap={1} alignItems="center">
      <CellImage cells={cells()} />
      <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
        cloudpilot-ai
      </text>
      <text fg={theme.textMuted} selectable={false}>
        AN AUTONOMOUS MULTI-AGENT CLOUD OPERATIONS PLATFORM
      </text>
    </box>
  )
}

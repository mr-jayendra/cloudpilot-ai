// Renders pre-rasterized image cells with ordinary OpenTUI text nodes.
//
// Each cell is one terminal character (" ", "▀", "▄") with optional
// foreground/background colors. No image bytes are sent to the terminal and
// no Kitty/Sixel/iTerm2 protocol is used, so this works on any ANSI/Unicode
// terminal including Windows Terminal, PowerShell, and VS Code.
import { RGBA } from "@opentui/core"
import { For, createMemo, type JSX } from "solid-js"
import type { MascotCell } from "../mascot/raster"

const rgbaCache = new Map<string, RGBA>()

function toRgba(color: { r: number; g: number; b: number }): RGBA {
  const key = `${color.r},${color.g},${color.b}`
  const hit = rgbaCache.get(key)
  if (hit) return hit
  const value = RGBA.fromInts(color.r, color.g, color.b)
  rgbaCache.set(key, value)
  return value
}

export function CellImage(props: { cells: MascotCell[][] }): JSX.Element {
  const rows = createMemo(() =>
    props.cells.map((line) =>
      line.map((cell) => ({
        char: cell.char,
        fg: cell.fg ? toRgba(cell.fg) : undefined,
        bg: cell.bg ? toRgba(cell.bg) : undefined,
      })),
    ),
  )
  return (
    <box flexDirection="column">
      <For each={rows()}>
        {(line) => (
          <text selectable={false} wrapMode="none">
            <For each={line}>{(cell) => <span style={{ fg: cell.fg, bg: cell.bg }}>{cell.char}</span>}</For>
          </text>
        )}
      </For>
    </box>
  )
}

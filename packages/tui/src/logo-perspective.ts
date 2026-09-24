import { logo } from "./logo"

// A single terminal cell of the perspective-projected title.
// `right` preserves the original two-tone coloring: false renders with
// theme.textMuted (CLOUD), true renders with theme.text bold (PILOT).
// The charset is intentionally identical to the source (space + full block)
// so letterforms survive the projection instead of fragmenting into
// half-block textures.
export type PerspectiveCell = {
  char: " " | "█"
  right: boolean
}

export type PerspectiveOptions = {
  // Width of the far (top) edge relative to the source width.
  // Smaller values look farther away / higher in the sky. Kept moderate
  // (~0.9) so the word stays readable at 4 rows tall.
  topScale: number
  // Width of the near (bottom) edge relative to the source width.
  // Keep at 1 so the title never overflows its original footprint.
  bottomScale: number
}

const DEFAULT_OPTIONS: PerspectiveOptions = {
  topScale: 0.9,
  bottomScale: 1,
}

// Samples per cell axis for the box-filtered raster. Each destination cell
// is inverse-mapped through the homography and covered by SUB_X * SUB_Y
// probes; a cell is inked on majority vote, which keeps thin strokes intact.
const SUB_X = 5
const SUB_Y = 5
const INK_THRESHOLD = 0.5

type Point = {
  x: number
  y: number
}

// Combine the two-tone source (left + 1 gap column + right) into one grid
// so the projective transform sees the title as a single plane.
function combineSource() {
  const gap = 1
  const leftWidth = logo.left[0]?.length ?? 0
  const lines = logo.left.map((line, index) => line + " ".repeat(gap) + (logo.right[index] ?? ""))
  return { lines, leftWidth }
}

// An inked source cell contributes to the projected shape.
// Space and "_" are empty by construction; every other mark counts as ink.
function isInk(char: string | undefined) {
  return char !== undefined && char !== " " && char !== "_"
}

// Solve the 3x3 homography mapping the src quad onto the dst quad
// (h33 fixed to 1). Rectangle -> symmetric trapezoid is not affine, so this
// is a genuine projective transform of the whole plane: horizontal extents
// converge toward the top edge while vertical sampling compresses with
// distance. No row or character is ever shifted or scaled individually.
function solveHomography(src: Point[], dst: Point[]) {
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const s = src[i]!
    const d = dst[i]!
    a.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y])
    b.push(d.x)
    a.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y])
    b.push(d.y)
  }
  const h = solveLinear(a, b)
  return [
    [h[0]!, h[1]!, h[2]!],
    [h[3]!, h[4]!, h[5]!],
    [h[6]!, h[7]!, 1],
  ]
}

function solveLinear(a: number[][], b: number[]) {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row
    }
    const current = m[col]!
    const next = m[pivot]!
    m[col] = next
    m[pivot] = current
    const divisor = m[col]![col]!
    if (Math.abs(divisor) < 1e-12) continue
    for (let k = col; k <= n; k++) m[col]![k]! /= divisor
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = m[row]![col]!
      if (factor === 0) continue
      for (let k = col; k <= n; k++) m[row]![k]! -= factor * m[col]![k]!
    }
  }
  return m.map((row) => row[n]!)
}

function invertHomography(h: number[][]) {
  const a = h[0]![0]!
  const b = h[0]![1]!
  const c = h[0]![2]!
  const d = h[1]![0]!
  const e = h[1]![1]!
  const f = h[1]![2]!
  const g = h[2]![0]!
  const hh = h[2]![1]!
  const i = h[2]![2]!
  const det = a * (e * i - f * hh) - b * (d * i - f * g) + c * (d * hh - e * g)
  if (Math.abs(det) < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const inv = 1 / det
  return [
    [(e * i - f * hh) * inv, (c * hh - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * hh - e * g) * inv, (b * g - a * hh) * inv, (a * e - b * d) * inv],
  ]
}

function applyHomography(h: number[][], x: number, y: number): Point {
  const w = h[2]![0]! * x + h[2]![1]! * y + h[2]![2]!
  return {
    x: (h[0]![0]! * x + h[0]![1]! * y + h[0]![2]!) / w,
    y: (h[1]![0]! * x + h[1]![1]! * y + h[1]![2]!) / w,
  }
}

// Project the existing title as ONE rectangular plane through the trapezoid
// homography and rasterize back to terminal cells. Leading blank padding
// rows are preserved as-is; only the inked plane is projected. Output
// dimensions equal the source dimensions, so centering, tagline position,
// and overflow behavior are unchanged.
//
// perspectiveTransform(source, width, height, parameters): the source is the
// original logo cell matrix, the parameters are the far/near edge scales,
// and the output is the transformed cell matrix.
export function projectLogoPerspective(options: PerspectiveOptions = DEFAULT_OPTIONS): PerspectiveCell[][] {
  const source = combineSource()
  const width = source.lines[0]?.length ?? 0
  const height = source.lines.length
  if (width === 0 || height === 0) return []

  const blankRow = (): PerspectiveCell[] => Array.from({ length: width }, () => ({ char: " ", right: false }) as PerspectiveCell)
  const contentStart = source.lines.findIndex((line) => Array.from(line).some((char) => isInk(char)))
  if (contentStart === -1) return source.lines.map(() => blankRow())
  const contentHeight = height - contentStart

  const topWidth = width * options.topScale
  const bottomWidth = width * options.bottomScale
  const topLeft = (width - topWidth) / 2
  const topRight = (width + topWidth) / 2
  const bottomLeft = (width - bottomWidth) / 2
  const bottomRight = (width + bottomWidth) / 2

  const homography = solveHomography(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: contentHeight },
      { x: 0, y: contentHeight },
    ],
    [
      { x: topLeft, y: 0 },
      { x: topRight, y: 0 },
      { x: bottomRight, y: contentHeight },
      { x: bottomLeft, y: contentHeight },
    ],
  )
  const inverse = invertHomography(homography)

  const sampleCell = (col: number, row: number) => {
    let ink = 0
    let right = 0
    const total = SUB_X * SUB_Y
    for (let ix = 0; ix < SUB_X; ix++) {
      for (let iy = 0; iy < SUB_Y; iy++) {
        const mapped = applyHomography(inverse, col + (ix + 0.5) / SUB_X, row + (iy + 0.5) / SUB_Y)
        const sx = Math.floor(mapped.x)
        const sy = Math.floor(mapped.y)
        if (sx < 0 || sx >= width || sy < 0 || sy >= contentHeight) continue
        if (isInk(source.lines[contentStart + sy]?.[sx])) {
          ink++
          if (sx > source.leftWidth) right++
        }
      }
    }
    return { filled: ink / total >= INK_THRESHOLD, right: right * 2 >= ink && ink > 0 }
  }

  const output: PerspectiveCell[][] = source.lines.slice(0, contentStart).map(() => blankRow())
  for (let row = 0; row < contentHeight; row++) {
    const cells: PerspectiveCell[] = []
    for (let col = 0; col < width; col++) {
      const sampled = sampleCell(col, row)
      cells.push(sampled.filled ? { char: "█", right: sampled.right } : { char: " ", right: false })
    }
    output.push(cells)
  }
  return output
}

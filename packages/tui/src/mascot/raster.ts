// Terminal-cell rasterization for the CloudPilot mascot.
//
// Compatibility-first pipeline: PNG bytes -> RGBA pixels -> area-averaged
// resize -> half-block terminal cells. The output uses only ordinary text
// cells (" ", "▀", "▄" with foreground/background colors), so it renders on
// any ANSI/Unicode terminal. It never uses Kitty, Sixel, or iTerm2 image
// protocols and never sends image bytes to the terminal.
//
// Truecolor reduction is left to the OpenTUI renderer, which quantizes RGBA
// to the terminal palette automatically. Transparency is preserved: pixels
// below the alpha threshold produce uncolored space cells, so the theme
// background shows through.
import { inflateSync } from "node:zlib"

export interface DecodedImage {
  width: number
  height: number
  // Row-major RGBA bytes, length is width * height * 4.
  data: Uint8Array
}

export interface MascotRgb {
  r: number
  g: number
  b: number
}

export interface MascotCell {
  char: " " | "▀" | "▄"
  fg?: MascotRgb
  bg?: MascotRgb
}

// Alpha below this is treated as transparent, preserving the source
// transparency instead of painting a background-colored box.
const ALPHA_THRESHOLD = 32

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

export function decodePng(buffer: Uint8Array): DecodedImage {
  if (!hasSignature(buffer)) throw new Error("decodePng: not a PNG file")
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let headerSeen = false
  const idatParts: Uint8Array[] = []
  let idatLength = 0
  while (offset + 8 <= buffer.length) {
    const length = view.getUint32(offset)
    const type = readChunkType(buffer, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error("decodePng: truncated chunk")
    if (type === "IHDR") {
      width = view.getUint32(dataStart)
      height = view.getUint32(dataStart + 4)
      bitDepth = buffer[dataStart + 8]!
      colorType = buffer[dataStart + 9]!
      headerSeen = true
    } else if (type === "IDAT") {
      idatParts.push(buffer.slice(dataStart, dataEnd))
      idatLength += length
    } else if (type === "IEND") {
      break
    }
    offset = dataEnd + 4
  }
  if (!headerSeen) throw new Error("decodePng: missing IHDR")
  if (width === 0 || height === 0) throw new Error("decodePng: invalid dimensions")
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`decodePng: unsupported PNG (bit depth ${bitDepth}, color type ${colorType})`)
  }
  if (idatParts.length === 0) throw new Error("decodePng: missing image data")
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const raw = inflateSync(concat(idatParts, idatLength))
  const pixels = unfilter(raw, width, height, bytesPerPixel)
  if (colorType === 6) return { width, height, data: pixels }
  return { width, height, data: rgbToRgba(pixels, width, height) }
}

function hasSignature(buffer: Uint8Array) {
  if (buffer.length < 8) return false
  return PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)
}

function readChunkType(buffer: Uint8Array, offset: number) {
  return String.fromCharCode(buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!)
}

function concat(parts: Uint8Array[], total: number) {
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// Reverses PNG per-scanline filtering (None, Sub, Up, Average, Paeth).
function unfilter(raw: Uint8Array, width: number, height: number, bytesPerPixel: number) {
  const stride = width * bytesPerPixel
  const out = new Uint8Array(width * height * bytesPerPixel)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const rowIn = y * (stride + 1) + 1
    const rowOut = y * stride
    for (let x = 0; x < stride; x++) {
      const current = raw[rowIn + x]!
      const a = x >= bytesPerPixel ? out[rowOut + x - bytesPerPixel]! : 0
      const b = y > 0 ? out[rowOut - stride + x]! : 0
      const c = x >= bytesPerPixel && y > 0 ? out[rowOut - stride + x - bytesPerPixel]! : 0
      out[rowOut + x] = (current + reconstruct(filter, a, b, c)) & 0xff
    }
  }
  return out
}

function reconstruct(filter: number, a: number, b: number, c: number) {
  if (filter === 1) return a
  if (filter === 2) return b
  if (filter === 3) return (a + b) >> 1
  if (filter === 4) return paeth(a, b, c)
  return 0
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function rgbToRgba(pixels: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    out[j] = pixels[i]!
    out[j + 1] = pixels[i + 1]!
    out[j + 2] = pixels[i + 2]!
    out[j + 3] = 255
  }
  return out
}

// Area-average downscale in premultiplied-alpha space so translucent glow
// edges shrink without dark or light fringes.
export function resizeRgba(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Uint8Array {
  const dst = new Uint8Array(dstWidth * dstHeight * 4)
  const xScale = srcWidth / dstWidth
  const yScale = srcHeight / dstHeight
  for (let dy = 0; dy < dstHeight; dy++) {
    const y0 = Math.floor(dy * yScale)
    const y1 = Math.min(srcHeight, Math.ceil((dy + 1) * yScale))
    for (let dx = 0; dx < dstWidth; dx++) {
      const x0 = Math.floor(dx * xScale)
      const x1 = Math.min(srcWidth, Math.ceil((dx + 1) * xScale))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const offset = (y * srcWidth + x) * 4
          const alpha = src[offset + 3]! / 255
          r += src[offset]! * alpha
          g += src[offset + 1]! * alpha
          b += src[offset + 2]! * alpha
          a += alpha
        }
      }
      const count = Math.max(1, (x1 - x0) * (y1 - y0))
      const target = (dy * dstWidth + dx) * 4
      const avgAlpha = a / count
      dst[target + 3] = Math.round(avgAlpha * 255)
      if (avgAlpha <= 0) continue
      dst[target] = Math.round(r / a)
      dst[target + 1] = Math.round(g / a)
      dst[target + 2] = Math.round(b / a)
    }
  }
  return dst
}

// Packs two pixel rows into one terminal row using half blocks, doubling
// the effective vertical resolution. Each cell keeps the source colors, and
// fully transparent pairs stay uncolored spaces.
export function rasterizeToCells(pixels: Uint8Array, width: number, height: number): MascotCell[][] {
  const rows: MascotCell[][] = []
  for (let y = 0; y < height; y += 2) {
    const row: MascotCell[] = []
    for (let x = 0; x < width; x++) {
      row.push(pairCell(pixels, width, height, x, y))
    }
    rows.push(row)
  }
  return trimCells(rows)
}

function pairCell(pixels: Uint8Array, width: number, height: number, x: number, y: number): MascotCell {
  const top = readPixel(pixels, width, x, y)
  const bottom = y + 1 < height ? readPixel(pixels, width, x, y + 1) : { r: 0, g: 0, b: 0, a: 0 }
  const topOn = top.a >= ALPHA_THRESHOLD
  const bottomOn = bottom.a >= ALPHA_THRESHOLD
  if (!topOn && !bottomOn) return { char: " " }
  if (topOn && !bottomOn) return { char: "▀", fg: { r: top.r, g: top.g, b: top.b } }
  if (!topOn && bottomOn) return { char: "▄", fg: { r: bottom.r, g: bottom.g, b: bottom.b } }
  return { char: "▀", fg: { r: top.r, g: top.g, b: top.b }, bg: { r: bottom.r, g: bottom.g, b: bottom.b } }
}

function readPixel(pixels: Uint8Array, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4
  return { r: pixels[offset]!, g: pixels[offset + 1]!, b: pixels[offset + 2]!, a: pixels[offset + 3]! }
}

// Removes fully transparent outer rows and columns so the art stays tight
// and centered without wasting terminal rows. Inner rows keep equal length.
export function trimCells(cells: MascotCell[][]): MascotCell[][] {
  const height = cells.length
  const width = cells[0]?.length ?? 0
  if (height === 0 || width === 0) return cells
  let top = height
  let bottom = -1
  let left = width
  let right = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (cells[y]![x]!.char === " ") continue
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  if (bottom === -1) return []
  return cells.slice(top, bottom + 1).map((row) => row.slice(left, right + 1))
}

// Full pipeline for one target cell width: decode, scale proportionally to
// that width (two pixel rows per cell row), then rasterize.
export function rasterizePng(buffer: Uint8Array, cellWidth: number): MascotCell[][] {
  const decoded = decodePng(buffer)
  const pixelHeight = Math.round((cellWidth * decoded.height) / decoded.width)
  const evenHeight = Math.max(2, pixelHeight + (pixelHeight % 2))
  const resized = resizeRgba(decoded.data, decoded.width, decoded.height, cellWidth, evenHeight)
  return rasterizeToCells(resized, cellWidth, evenHeight)
}

export * as MascotRaster from "./raster"

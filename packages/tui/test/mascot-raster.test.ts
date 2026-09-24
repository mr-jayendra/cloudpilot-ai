import { describe, expect, test } from "bun:test"
import { pickMascotWidth } from "../src/component/logo"
import { mascotCells, mascotCellWidths } from "../src/mascot/cells"
import { decodePng, rasterizePng, rasterizeToCells, resizeRgba, trimCells } from "../src/mascot/raster"

const pngUrl = new URL("../../../cloudpilot_logo.png", import.meta.url)

function pixel(data: Uint8Array, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4
  return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]!, a: data[offset + 3]! }
}

describe("mascot-raster", () => {
  test("decodes the root PNG with transparency preserved", async () => {
    const buffer = new Uint8Array(await Bun.file(pngUrl).arrayBuffer())
    const img = decodePng(buffer)
    expect(img.width).toBe(1536)
    expect(img.height).toBe(1024)
    expect(img.data.length).toBe(1536 * 1024 * 4)
    expect(pixel(img.data, img.width, 0, 0).a).toBe(0)
    expect(pixel(img.data, img.width, img.width - 1, img.height - 1).a).toBe(0)
    const center = pixel(img.data, img.width, img.width >> 1, img.height >> 1)
    expect(center.a).toBeGreaterThan(200)
  })

  test("rejects non-PNG input", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow()
  })

  test("resize keeps dimensions and transparency", async () => {
    const buffer = new Uint8Array(await Bun.file(pngUrl).arrayBuffer())
    const img = decodePng(buffer)
    const small = resizeRgba(img.data, img.width, img.height, 44, 30)
    expect(small.length).toBe(44 * 30 * 4)
    expect(pixel(small, 44, 0, 0).a).toBeLessThan(32)
  })

  test("half-block packing covers all transparency combinations", () => {
    const on = [255, 255, 255, 255]
    const off = [0, 0, 0, 0]
    const dark = [10, 10, 10, 255]
    const pixels = new Uint8Array([...on, ...dark, ...off, ...off, ...off, ...dark, ...on, ...off])
    const rows = rasterizeToCells(pixels, 4, 2)
    expect(rows.length).toBe(1)
    expect(rows[0]!.length).toBe(3)
    expect(rows[0]![0]).toEqual({ char: "▀", fg: { r: 255, g: 255, b: 255 } })
    expect(rows[0]![1]).toEqual({
      char: "▀",
      fg: { r: 10, g: 10, b: 10 },
      bg: { r: 10, g: 10, b: 10 },
    })
    expect(rows[0]![2]).toEqual({ char: "▄", fg: { r: 255, g: 255, b: 255 } })
  })

  test("trims transparent borders but keeps rows rectangular", () => {
    const trimmed = trimCells([
      [{ char: " " }, { char: " " }, { char: " " }],
      [{ char: " " }, { char: "▀", fg: { r: 1, g: 1, b: 1 } }, { char: " " }],
      [{ char: " " }, { char: " " }, { char: " " }],
    ])
    expect(trimmed.length).toBe(1)
    expect(trimmed[0]!.length).toBe(1)
  })

  test("pipeline output uses only ordinary text cells", async () => {
    const buffer = new Uint8Array(await Bun.file(pngUrl).arrayBuffer())
    for (const width of [12, 20, 28, 36, 44]) {
      const cells = rasterizePng(buffer, width)
      expect(cells.length).toBeGreaterThan(0)
      const rowLength = cells[0]!.length
      let ink = 0
      for (const row of cells) {
        expect(row.length).toBe(rowLength)
        for (const cell of row) {
          expect([" ", "▀", "▄"]).toContain(cell.char)
          if (cell.char !== " ") ink++
          for (const color of [cell.fg, cell.bg]) {
            if (!color) continue
            expect(color.r).toBeGreaterThanOrEqual(0)
            expect(color.r).toBeLessThanOrEqual(255)
          }
        }
      }
      expect(ink).toBeGreaterThan(0)
    }
  })

  test("checked-in cells match the pipeline", async () => {
    const buffer = new Uint8Array(await Bun.file(pngUrl).arrayBuffer())
    for (const width of mascotCellWidths) {
      expect(mascotCells[width]).toEqual(rasterizePng(buffer, width))
    }
  })

  test("picks art that fits narrow, normal, wide, and short terminals", () => {
    expect(pickMascotWidth(100, 30)).toBe(44)
    expect(pickMascotWidth(80, 24)).toBe(28)
    expect(pickMascotWidth(30, 24)).toBe(20)
    expect(pickMascotWidth(20, 10)).toBe(12)
    expect(pickMascotWidth(100, 16)).toBe(12)
  })

  test("home logo block fits a 24-row terminal", () => {
    const width = pickMascotWidth(80, 24)
    const rows = mascotCells[width]!.length + 1 + 1 + 1
    expect(rows).toBeLessThanOrEqual(24 - 10)
  })
})

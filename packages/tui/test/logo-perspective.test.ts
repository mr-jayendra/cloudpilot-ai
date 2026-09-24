import { describe, expect, test } from "bun:test"
import { logo } from "../src/logo"
import { projectLogoPerspective } from "../src/logo-perspective"

describe("logo-perspective", () => {
  test("preserves source dimensions so layout and centering are unchanged", () => {
    const sourceWidth = logo.left[0]?.length ?? 0
    const grid = projectLogoPerspective()
    expect(grid.length).toBe(logo.left.length)
    for (const row of grid) expect(row.length).toBe(sourceWidth + 1 + (logo.right[0]?.length ?? 0))
  })

  test("widens monotonically downward like a title viewed from below", () => {
    const grid = projectLogoPerspective()
    const widths = grid.map((row) => {
      const first = row.findIndex((cell) => cell.char !== " ")
      if (first === -1) return 0
      let last = first
      row.forEach((cell, index) => {
        if (cell.char !== " ") last = index
      })
      return last - first + 1
    })
    // Row 0 is the preserved top spacer; the inked plane converges upward.
    expect(widths[0]).toBe(0)
    for (let i = 2; i < widths.length; i++) expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]!)
  })

  test("keeps both tones of the existing title", () => {
    const grid = projectLogoPerspective()
    const ink = grid.flat().filter((cell) => cell.char !== " ")
    expect(ink.length).toBeGreaterThan(0)
    expect(ink.some((cell) => cell.right)).toBe(true)
    expect(ink.some((cell) => !cell.right)).toBe(true)
  })
})

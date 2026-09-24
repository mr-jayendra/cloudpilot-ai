/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { CellImage } from "../src/component/image"
import { mascotCells } from "../src/mascot/cells"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

async function renderCells(width: number, termWidth: number, termHeight: number) {
  testSetup = await testRender(() => <CellImage cells={mascotCells[width] ?? []} />, {
    width: termWidth,
    height: termHeight,
  })
  await testSetup.renderOnce()
  await testSetup.renderOnce()
  return testSetup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

describe("mascot-logo-render", () => {
  test("renders half-block art through ordinary text cells", async () => {
    const frame = await renderCells(28, 80, 24)
    expect(frame).toMatch(/[▀▄]/)
    expect(frame.split("\n").length).toBe(mascotCells[28]!.length)
  })

  test("renders the largest art on a wide terminal", async () => {
    const frame = await renderCells(44, 100, 30)
    expect(frame).toMatch(/[▀▄]/)
    expect(frame.split("\n").length).toBe(mascotCells[44]!.length)
  })

  test("renders the smallest art on a narrow terminal without throwing", async () => {
    const frame = await renderCells(12, 24, 12)
    expect(frame.split("\n").length).toBe(mascotCells[12]!.length)
  })
})

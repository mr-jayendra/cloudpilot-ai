import { describe, expect, test } from "bun:test"
import {
  formatSlashDisplay,
  slashIcon,
  slashIconFallback,
  slashIconForSource,
  slashIcons,
} from "../../src/prompt/slash-icons"

// Exact approved mapping. "/" stays the real syntax; icons are display only.
const expected: Record<string, string> = {
  sessions: "≡",
  new: "+",
  share: "↗",
  unshare: "×",
  rename: "✎",
  fork: "⑂",
  compact: "⇣",
  undo: "↶",
  redo: "↷",
  timeline: "◷",
  copy: "⧉",
  export: "⇧",
  models: "◉",
  agents: "◇",
  variants: "◐",
  mcps: "⊞",
  connect: "↔",
  org: "◎",
  themes: "◈",
  workspaces: "▦",
  warp: "⇄",
  move: "➜",
  status: "●",
  debug: "⚙",
  thinking: "∴",
  timestamps: "◷",
  diff: "±",
  help: "?",
  editor: "✎",
  skills: "★",
  exit: "⏻",
  init: "∗",
  review: "✓",
}

describe("slash-icons", () => {
  test("maps every approved command to its exact icon", () => {
    for (const [name, icon] of Object.entries(expected)) {
      expect(slashIcon(name)).toBe(icon)
      expect(slashIcon(`/${name}`)).toBe(icon)
    }
  })

  test("covers every registered slash command", () => {
    const registered = [
      "sessions",
      "new",
      "workspaces",
      "models",
      "agents",
      "mcps",
      "variants",
      "connect",
      "org",
      "status",
      "debug",
      "themes",
      "help",
      "exit",
      "share",
      "rename",
      "timeline",
      "fork",
      "compact",
      "unshare",
      "undo",
      "redo",
      "timestamps",
      "thinking",
      "copy",
      "export",
      "editor",
      "skills",
      "warp",
      "move",
      "diff",
    ]
    for (const name of registered) {
      expect(slashIcon(name)).not.toBe(slashIconFallback)
    }
    for (const name of registered) {
      expect(Object.keys(slashIcons)).toContain(name)
    }
  })

  test("every icon is a single terminal cell", () => {
    for (const icon of [...Object.values(slashIcons), "◆"]) {
      expect(Bun.stringWidth(icon)).toBe(1)
    }
    expect(Bun.stringWidth(slashIconFallback)).toBe(1)
  })

  test("falls back for unknown and dynamic commands", () => {
    expect(slashIcon("nope")).toBe(slashIconFallback)
    expect(slashIcon("deploy:mcp")).toBe("⊞")
    expect(slashIcon("/deploy:mcp")).toBe("⊞")
    expect(slashIconForSource("mcp", "deploy")).toBe("⊞")
    expect(slashIconForSource("command", "init")).toBe("∗")
    expect(slashIconForSource("command", "review")).toBe("✓")
    expect(slashIconForSource("command", "my-custom")).toBe("◆")
    expect(slashIconForSource(undefined, "nope")).toBe(slashIconFallback)
  })

  test("formats a fixed-width icon column without the slash", () => {
    expect(formatSlashDisplay("models")).toBe("◉  models")
    expect(formatSlashDisplay("/models")).toBe("◉  models")
    expect(formatSlashDisplay("deploy:mcp")).toBe("⊞  deploy:mcp")
    expect(formatSlashDisplay("nope")).toBe("•  nope")
    expect(formatSlashDisplay("init", "command")).toBe("∗  init")
    expect(formatSlashDisplay("review", "command")).toBe("✓  review")
    expect(formatSlashDisplay("my-custom", "command")).toBe("◆  my-custom")
    expect(formatSlashDisplay("deploy", "mcp")).toBe("⊞  deploy")
  })
})

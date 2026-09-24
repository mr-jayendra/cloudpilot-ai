// Centralized icon map for the "/" command menu.
//
// Icons are PRESENTATION ONLY: the real command syntax stays "/<name>" and
// filtering/matching always operate on that syntax (see `value` on
// AutocompleteOption). Every icon here must be a single terminal cell; emoji
// and double-width characters (e.g. fullwidth ＋) are not allowed because
// they break the fixed-width icon column. Unknown commands fall back to "•".
export const slashIcons: Record<string, string> = {
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
  "cloud-providers": "☁",
  "cloud-provider": "☁",
  cloud: "☁",
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

export const slashIconFallback = "•"

export function slashIcon(name: string): string {
  const bare = name.startsWith("/") ? name.slice(1) : name
  if (bare.endsWith(":mcp")) return "⊞"
  return slashIcons[bare] ?? slashIconFallback
}

// Source-aware variant for server-provided commands. Built-in and custom
// "command"-source entries (init, review, user config commands) get their
// mapped icon, or "◆" when the name is user-defined and unmapped.
export function slashIconForSource(source: string | undefined, name: string): string {
  const bare = name.startsWith("/") ? name.slice(1) : name
  if (source === "mcp" || bare.endsWith(":mcp")) return "⊞"
  if (source === "command") return slashIcons[bare] ?? "◆"
  return slashIcons[bare] ?? slashIconFallback
}

// Renders "ICON  name" with a fixed-width icon column. The "/" prefix is
// intentionally not rendered; the underlying command keeps its "/<name>"
// syntax and `value` for filtering and execution.
export function formatSlashDisplay(name: string, source?: string): string {
  const bare = name.startsWith("/") ? name.slice(1) : name
  return `${slashIconForSource(source, bare)}  ${bare}`
}

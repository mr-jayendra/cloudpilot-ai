import type { TuiPlugin, TuiPluginApi } from "@cloudpilot-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createResource, createSignal, For, Show } from "solid-js"
import { getConnectedCloudProviders } from "../../util/cloud-provider"

const id = "internal:sidebar-cloud-provider"

function View(props: { api: TuiPluginApi }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const [connected] = createResource(getConnectedCloudProviders)
  const list = () => connected() ?? []

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => list().length > 2 && setOpen((x) => !x)}>
          <Show when={list().length > 2}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Cloud</b>
          </text>
        </box>
        <Show when={list().length <= 2 || open()}>
          <For each={list()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: theme().success }}>
                  •
                </text>
                <text fg={theme().text} wrapMode="word">
                  {item.title} <span style={{ fg: theme().textMuted }}>Connected</span>
                </text>
              </box>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 210,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin

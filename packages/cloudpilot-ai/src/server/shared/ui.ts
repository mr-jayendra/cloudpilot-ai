import type { FSUtil } from "@cloudpilot-ai/core/fs-util"
import { Effect } from "effect"
import type { HttpClient, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpServerResponse as HttpServerResponseImpl } from "effect/unstable/http"

// Terminal-only CLI: web UI is disabled. This module is kept only so old
// imports do not break; all routes return 404.
export const UI_UPSTREAM = new URL("http://127.0.0.1/")

export const csp = (_hash = "") => `default-src 'self'`
export const DEFAULT_CSP = csp()

export function themePreloadHash(_body: string) {
  return null
}

export function cspForHtml(_body: string) {
  return csp()
}

export function upstreamURL(path: string) {
  return new URL(path, UI_UPSTREAM).toString()
}

export function embeddedUI(_disableEmbeddedWebUi: boolean) {
  return Promise.resolve(null)
}

function notFound() {
  return HttpServerResponseImpl.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

export function serveEmbeddedUIEffect(
  _requestPath: string,
  _fs: FSUtil.Interface,
  _embeddedWebUI: Record<string, string>,
) {
  return Effect.succeed(notFound())
}

export function serveUIEffect(
  _request: HttpServerRequest.HttpServerRequest,
  _services: { fs: FSUtil.Interface; client: HttpClient.HttpClient; disableEmbeddedWebUi: boolean },
) {
  return Effect.succeed(notFound())
}

export type { HttpServerResponse }

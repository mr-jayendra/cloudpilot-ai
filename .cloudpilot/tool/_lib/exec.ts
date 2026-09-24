// Shared process-execution helpers for the Deploy Agent's tools.
//
// Every cloud/CLI interaction in the deploy toolset goes through here so
// that: (1) output capture, (2) timeouts, and (3) "is this CLI even
// installed" checks are handled in exactly one place.

import { spawn } from "node:child_process"

export interface ExecResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  command: string
}

export interface ExecOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** Called with incremental output as it arrives, for live streaming into chat. */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void
}

/**
 * Run a command and capture its output. Never throws on non-zero exit --
 * callers must check `.ok`/`.code` themselves and report the real failure
 * instead of assuming success (see the "no fake success" requirement).
 */
export function run(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
    })

    let stdout = ""
    let stderr = ""
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL")
        }, options.timeoutMs)
      : undefined

    child.stdout.on("data", (data) => {
      const text = data.toString()
      stdout += text
      options.onOutput?.(text, "stdout")
    })
    child.stderr.on("data", (data) => {
      const text = data.toString()
      stderr += text
      options.onOutput?.(text, "stderr")
    })

    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout)
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        command: [command, ...args].join(" "),
      })
    })

    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout)
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        command: [command, ...args].join(" "),
      })
    })
  })
}

/** Checks whether a CLI binary is on PATH (used before ever assuming a tool exists). */
export async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which"
  const result = await run(probe, [command])
  return result.ok
}

/** ssh wrapper -- always non-interactive, always with a sane timeout, never prompts for a password. */
export async function ssh(host: string, user: string, keyPath: string, remoteCommand: string, options: ExecOptions = {}) {
  return run(
    "ssh",
    [
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "BatchMode=yes",
      "-i",
      keyPath,
      `${user}@${host}`,
      remoteCommand,
    ],
    { timeoutMs: 30_000, ...options },
  )
}

export async function rsyncUpload(
  localDir: string,
  host: string,
  user: string,
  keyPath: string,
  remoteDir: string,
  options: ExecOptions = {},
) {
  return run(
    "rsync",
    [
      "-az",
      "--delete",
      "--exclude",
      ".git",
      "--exclude",
      "node_modules",
      "--exclude",
      ".cloudpilot",
      "--exclude",
      "__pycache__",
      "--exclude",
      ".venv",
      "-e",
      `ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -i ${keyPath}`,
      `${localDir.endsWith("/") ? localDir : localDir + "/"}`,
      `${user}@${host}:${remoteDir}`,
    ],
    { timeoutMs: 120_000, ...options },
  )
}

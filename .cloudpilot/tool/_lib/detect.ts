// Lightweight, dependency-free project analysis. This deliberately does NOT
// call out to an LLM -- it is meant to give the Deploy Agent (which IS the
// LLM) a fast, deterministic set of facts to reason over, the same way
// `deploy-analyze` output feeds into the agent's own planning.

import { promises as fs } from "node:fs"
import path from "node:path"

export type AppType = "node" | "python" | "go" | "static" | "docker" | "unknown"

export interface AppDetection {
  appType: AppType
  reasons: string[]
  buildCommand?: string
  startCommand?: string
  installCommand?: string
  port?: number
  hasDocker: boolean
  hasDockerCompose: boolean
  packageManager?: "npm" | "pnpm" | "yarn" | "bun"
  entryFile?: string
  warnings: string[]
}

async function exists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJson(p: string): Promise<any | undefined> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"))
  } catch {
    return undefined
  }
}

function guessPortFromText(text: string): number | undefined {
  const match = text.match(/(?:PORT|port)\s*[:=]\s*["']?(\d{2,5})["']?/)
  if (match) return Number(match[1])
  const listenMatch = text.match(/listen\((\d{2,5})/)
  if (listenMatch) return Number(listenMatch[1])
  return undefined
}

export async function detectApp(projectDir: string): Promise<AppDetection> {
  const reasons: string[] = []
  const warnings: string[] = []
  const hasDocker = await exists(path.join(projectDir, "Dockerfile"))
  const hasDockerCompose =
    (await exists(path.join(projectDir, "docker-compose.yml"))) || (await exists(path.join(projectDir, "docker-compose.yaml")))

  // Node.js
  const pkgJsonPath = path.join(projectDir, "package.json")
  if (await exists(pkgJsonPath)) {
    const pkg = await readJson(pkgJsonPath)
    reasons.push("Found package.json")
    let packageManager: AppDetection["packageManager"] = "npm"
    if (await exists(path.join(projectDir, "bun.lock"))) packageManager = "bun"
    else if (await exists(path.join(projectDir, "pnpm-lock.yaml"))) packageManager = "pnpm"
    else if (await exists(path.join(projectDir, "yarn.lock"))) packageManager = "yarn"

    const installCommand =
      packageManager === "bun" ? "bun install --frozen-lockfile" : packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : packageManager === "yarn" ? "yarn install --frozen-lockfile" : "npm ci"

    const scripts = pkg?.scripts ?? {}
    const buildCommand = scripts.build ? `${packageManager} run build` : undefined
    let startCommand: string | undefined
    if (scripts.start) startCommand = `${packageManager} run start`
    else if (pkg?.main) startCommand = `node ${pkg.main}`

    let port: number | undefined
    for (const candidate of ["server.js", "index.js", "src/index.js", "app.js"]) {
      const full = path.join(projectDir, candidate)
      if (await exists(full)) {
        const text = await fs.readFile(full, "utf8").catch(() => "")
        const found = guessPortFromText(text)
        if (found) {
          port = found
          break
        }
      }
    }

    return {
      appType: "node",
      reasons,
      buildCommand,
      startCommand,
      installCommand,
      port: port ?? 3000,
      hasDocker,
      hasDockerCompose,
      packageManager,
      entryFile: pkg?.main,
      warnings: startCommand ? warnings : [...warnings, "No 'start' script or 'main' entry found in package.json -- start command will need confirmation"],
    }
  }

  // Python
  const hasRequirements = await exists(path.join(projectDir, "requirements.txt"))
  const hasPyProject = await exists(path.join(projectDir, "pyproject.toml"))
  if (hasRequirements || hasPyProject) {
    reasons.push(hasRequirements ? "Found requirements.txt" : "Found pyproject.toml")
    let startCommand: string | undefined
    let port: number | undefined
    for (const candidate of ["main.py", "app.py", "manage.py", "wsgi.py", "asgi.py"]) {
      if (await exists(path.join(projectDir, candidate))) {
        const text = await fs.readFile(path.join(projectDir, candidate), "utf8").catch(() => "")
        port = guessPortFromText(text) ?? port
        if (candidate === "manage.py") startCommand = "python manage.py runserver 0.0.0.0:8000"
        else if (text.includes("FastAPI") || text.includes("uvicorn")) startCommand = `uvicorn ${candidate.replace(".py", "")}:app --host 0.0.0.0 --port ${port ?? 8000}`
        else if (text.includes("Flask")) startCommand = `python ${candidate}`
        else startCommand = `python ${candidate}`
        break
      }
    }
    return {
      appType: "python",
      reasons,
      installCommand: "pip install -r requirements.txt",
      startCommand,
      port: port ?? 8000,
      hasDocker,
      hasDockerCompose,
      warnings: startCommand ? warnings : [...warnings, "Could not determine how to start this Python app -- please confirm the run command"],
    }
  }

  // Go
  if (await exists(path.join(projectDir, "go.mod"))) {
    reasons.push("Found go.mod")
    return {
      appType: "go",
      reasons,
      buildCommand: "go build -o app .",
      startCommand: "./app",
      port: 8080,
      hasDocker,
      hasDockerCompose,
      warnings,
    }
  }

  // Static site
  for (const candidate of ["index.html", "public/index.html", "dist/index.html", "build/index.html"]) {
    if (await exists(path.join(projectDir, candidate))) {
      reasons.push(`Found ${candidate}`)
      return {
        appType: "static",
        reasons,
        port: 80,
        hasDocker,
        hasDockerCompose,
        warnings,
      }
    }
  }

  if (hasDocker) {
    return {
      appType: "docker",
      reasons: ["Found Dockerfile but no recognizable language manifest"],
      hasDocker,
      hasDockerCompose,
      port: undefined,
      warnings: ["Port could not be inferred from the Dockerfile -- please confirm the EXPOSE port"],
    }
  }

  return {
    appType: "unknown",
    reasons: ["No package.json, requirements.txt, pyproject.toml, go.mod, Dockerfile, or static index.html found"],
    hasDocker,
    hasDockerCompose,
    warnings: ["Could not automatically detect the application type. Ask the user what this project is and how it runs."],
  }
}

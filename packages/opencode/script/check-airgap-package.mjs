#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile, realpath } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"

assert.equal(process.versions.node.split(".")[0], "22", "Run with Node.js 22")
const root = await mkdtemp(path.join(tmpdir(), "opencode-package-check-"))
let executable = path.resolve(process.argv[2])
const env = {
  ...process.env,
  HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_STATE_HOME: path.join(root, "state"),
  OPENCODE_AIR_GAPPED: "on",
  npm_config_update_notifier: "false",
}
await mkdir(path.join(root, "project"))

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      cwd: path.join(root, "project"),
      timeout: command === "npm" || args.includes("--version") ? 900_000 : 120_000,
    })
    child.stdin.end()
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (data) => {
      stdout += data
    })
    child.stderr.on("data", (data) => {
      stderr += data
    })
    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (code !== 0) return reject(new Error(`${command} exited ${code}/${signal}\n${stdout}\n${stderr}`))
      resolve(stdout)
    })
  })
}

console.log("OS:", (await readFile("/etc/os-release", "utf8")).match(/^PRETTY_NAME=(.*)$/m)?.[1])
console.log("Node:", process.version)
console.log("Standalone:", (await run(executable, ["--version"])).trim())
if (process.argv[3]) {
  console.log("Installing npm tarball offline with empty npm cache")
  await run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--update-notifier=false",
    "--global",
    "--prefix",
    path.join(root, "npm"),
    "--cache",
    path.join(root, "npm-cache"),
    path.resolve(process.argv[3]),
  ])
  executable = await realpath(path.join(root, "npm/bin/opencode"))
  delete env.OPENCODE_AIR_GAP_DIR
  console.log("npm installed:", (await run(executable, ["--version"])).trim())
  const manifest = JSON.parse(await readFile(path.resolve(path.dirname(executable), "../package.json")))
  const assets = path.join(env.XDG_CACHE_HOME, "opencode/air-gap", manifest.opencodeAssetsSha256, "assets")
  assert(
    JSON.parse(await readFile(path.join(assets, "cache/packages/prettier/node_modules/prettier/package.json"))).version,
  )
  console.log(
    "Packaged formatter on Node 22:",
    (
      await run(process.execPath, [
        path.join(assets, "cache/packages/prettier/node_modules/prettier/bin/prettier.cjs"),
        "--version",
      ])
    ).trim(),
  )
}

if (process.env.CHECK_TUI === "1") {
  const socket = path.join(root, "tmux.sock")
  await run("tmux", [
    "-S",
    socket,
    "new-session",
    "-d",
    "-s",
    "offline",
    "-x",
    "120",
    "-y",
    "35",
    `'${executable.replaceAll("'", "'\\''")}'`,
  ])
  try {
    let screen = ""
    for (let attempt = 0; attempt < 120; attempt++) {
      screen = await run("tmux", ["-S", socket, "capture-pane", "-p", "-t", "offline"])
      if (screen.includes("Ask anything")) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    assert.match(screen, /Ask anything/)
    await writeFile("/out/airgap-tui.txt", screen)
    console.log("Interactive TUI in tmux: passed")
  } finally {
    await run("tmux", ["-S", socket, "kill-server"])
  }
}

const requests = []
let sessionID
const model = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  requests.push(body)
  const tool = body.tools?.find((tool) => tool.function.name === "bash" || tool.function.name === "shell")
  const called = body.messages.some((message) => message.role === "tool")
  const delta =
    tool && !called
      ? {
          tool_calls: [
            {
              index: 0,
              id: "offline-call",
              type: "function",
              function: {
                name: tool.function.name,
                arguments: JSON.stringify({
                  command: "printf airgap-tool-ok",
                  description: "Verify offline shell execution",
                }),
              },
            },
          ],
        }
      : { content: "offline-model-ok\n\n```python\ndef hello():\n    return 42\n```" }
  response.writeHead(200, { "content-type": "text/event-stream" })
  for (const choice of [
    { index: 0, delta: { role: "assistant", ...delta }, finish_reason: null },
    { index: 0, delta: {}, finish_reason: tool && !called ? "tool_calls" : "stop" },
  ]) {
    response.write(
      `data: ${JSON.stringify({ id: "offline-response", object: "chat.completion.chunk", created: 1, model: "offline-test", choices: [choice] })}\n\n`,
    )
  }
  response.end("data: [DONE]\n\n")
})
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve))
try {
  await writeFile(
    path.join(root, "project/opencode.json"),
    JSON.stringify({
      model: "local/offline-test",
      permission: { "*": "allow" },
      provider: {
        local: {
          npm: "@ai-sdk/openai-compatible",
          name: "Local test service",
          options: { baseURL: `http://127.0.0.1:${model.address().port}/v1` },
          models: { "offline-test": { name: "Offline test", limit: { context: 32768, output: 1024 } } },
        },
      },
    }),
  )
  const output = await run(executable, [
    "run",
    "--format",
    "json",
    "--model",
    "local/offline-test",
    "Execute the shell test then respond",
  ])
  sessionID = output.match(/"sessionID":"([^"]+)"/)?.[1]
  assert.match(output, /offline-model-ok/)
  assert(requests.length >= 2, "Expected a tool call and a model continuation")
  assert(
    requests.some((body) =>
      body.messages.some(
        (message) => message.role === "tool" && JSON.stringify(message.content).includes("airgap-tool-ok"),
      ),
    ),
    "Shell tool result must return to the local model",
  )
  console.log("Local streamed model + real shell tool + continuation: passed")
} finally {
  model.closeAllConnections()
  await new Promise((resolve) => model.close(resolve))
}

const server = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", "41357"], {
  env,
  cwd: path.join(root, "project"),
  stdio: "ignore",
})
const closed = new Promise((resolve) => server.once("close", resolve))
try {
  console.log("Checking embedded Web UI")
  let response
  for (let attempt = 0; attempt < 600; attempt++) {
    response = await fetch("http://127.0.0.1:41357", { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
    if (response) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert(response?.ok, "Embedded UI must load without an upstream server")
  const html = await response.text()
  assert.match(html, /<html/)
  assert(html.includes('<meta name="opencode-air-gapped" content="on">'))
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/)
  const script = html.match(/src="([^"]+\.js)"/)
  assert(script, "Embedded UI must include its application script")
  const javascript = await fetch(new URL(script[1], "http://127.0.0.1:41357"), { signal: AbortSignal.timeout(5000) })
  assert(javascript.ok)
  await javascript.body.cancel()
  console.log("Embedded Web UI HTML + JavaScript + offline CSP: passed")
  if (process.env.CHECK_BROWSER) {
    assert(sessionID, "The CLI must emit a session ID")
    const directory = Buffer.from(path.join(root, "project")).toString("base64url")
    await run("agent-browser", ["open", `http://127.0.0.1:41357/${directory}/session/${sessionID}`])
    await run("agent-browser", ["wait", "--text", "offline-model-ok"])
    await run("agent-browser", [
      "wait",
      "--fn",
      "document.querySelectorAll('pre.shiki code span[style]').length > 0",
    ]).catch(async (error) => {
      await run("agent-browser", ["screenshot", "/out/airgap-highlight-failure.png"])
      console.log(await run("agent-browser", ["errors"]))
      console.log(await run("agent-browser", ["eval", "document.querySelector('main')?.innerHTML"]))
      throw error
    })
    const highlighted = await run("agent-browser", [
      "eval",
      "document.querySelectorAll('pre.shiki code span[style]').length",
    ])
    assert(Number(highlighted.trim()) > 0, "The packaged browser must render syntax-colored code tokens")
    const resources = await run("agent-browser", [
      "eval",
      "performance.getEntriesByType('resource').filter(x => !x.name.startsWith(location.origin) && !x.name.startsWith('blob:') && !x.name.startsWith('data:')).map(x => x.name)",
    ])
    assert.equal(resources.trim(), "[]", "Browser assets must be local")
    await run("agent-browser", ["screenshot", "/out/airgap-highlight.png"])
    await run("agent-browser", ["close"])
    console.log("Browser code highlighting and local-only resources: passed")
  }
} finally {
  server.kill("SIGTERM")
  const kill = setTimeout(() => server.kill("SIGKILL"), 5000)
  await closed
  clearTimeout(kill)
}
console.log("Package checks passed. Test home:", root)

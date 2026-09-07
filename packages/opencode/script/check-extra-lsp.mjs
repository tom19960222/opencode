import { spawn } from "node:child_process"
import { mkdtemp, readdir, rm, cp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

const assets = process.env.OPENCODE_AIR_GAP_DIR
if (!assets) throw new Error("Set OPENCODE_AIR_GAP_DIR to the provisioned assets")
const temporary = await mkdtemp(path.join(tmpdir(), "opencode-extra-lsp-"))
const launcher = (await readdir(path.join(assets, "bin/jdtls/plugins"))).find((file) =>
  /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(file),
)
await cp(path.join(assets, "bin/jdtls/config_linux"), path.join(temporary, "java", "config"), { recursive: true })
const documentUri = pathToFileURL(path.join(temporary, "Main.kt")).href
const documentText = 'fun main() { val answer: Int = "wrong" }\n'
await writeFile(path.join(temporary, "Main.kt"), documentText)
const commands = [
  ["eslint", process.execPath, [path.join(assets, "bin/vscode-eslint/server/out/eslintServer.js"), "--stdio"]],
  [
    "jdtls",
    path.join(assets, "bin/java"),
    [
      "-jar",
      path.join(assets, "bin/jdtls/plugins", launcher),
      "-configuration",
      path.join(temporary, "java", "config"),
      "-data",
      path.join(temporary, "java"),
      "-Declipse.application=org.eclipse.jdt.ls.core.id1",
      "-Dosgi.bundles.defaultStartLevel=4",
      "-Declipse.product=org.eclipse.jdt.ls.core.product",
      "-Dlog.level=ALL",
      "--add-modules=ALL-SYSTEM",
      "--add-opens java.base/java.util=ALL-UNNAMED",
      "--add-opens java.base/java.lang=ALL-UNNAMED",
    ],
  ],
  ["kotlin", path.join(assets, "bin/kotlin-language-server"), []],
]
try {
  for (const [name, command, args] of commands) {
    const child = spawn(command, args, {
      cwd: temporary,
      env: { ...process.env, PATH: `${assets}/bin:${process.env.PATH}` },
    })
    const send = (value) => {
      const body = JSON.stringify(value)
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    let capabilities = 0
    let stderr = ""
    let buffer = Buffer.alloc(0)
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16000)
    })
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} initialize timed out\n${stderr}`)), 90000)
      child.once("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once("exit", (code) => {
        clearTimeout(timer)
        reject(new Error(`${name} exited ${code}\n${stderr}`))
      })
      child.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
          const end = buffer.indexOf("\r\n\r\n")
          if (end === -1) return
          const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1])
          if (!Number.isFinite(length)) {
            clearTimeout(timer)
            reject(new Error(`${name}: malformed LSP header`))
            return
          }
          if (buffer.length < end + 4 + length) return
          const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
          buffer = buffer.subarray(end + 4 + length)
          if (
            name === "kotlin" &&
            message.method === "textDocument/publishDiagnostics" &&
            message.params.uri === documentUri &&
            message.params.diagnostics.length
          ) {
            clearTimeout(timer)
            if (!message.params.diagnostics.some((diagnostic) => /type mismatch/i.test(diagnostic.message))) {
              reject(new Error(`Expected Kotlin type mismatch: ${JSON.stringify(message.params.diagnostics)}`))
              return
            }
            resolve(`${capabilities} capabilities; Kotlin type-mismatch diagnostic verified`)
            return
          }
          if (message.id !== 1) continue
          if (message.error || !message.result?.capabilities) {
            reject(new Error(`${name}: ${JSON.stringify(message)}`))
            return
          }
          capabilities = Object.keys(message.result.capabilities).length
          if (name === "kotlin") {
            send({ jsonrpc: "2.0", method: "initialized", params: {} })
            send({
              jsonrpc: "2.0",
              method: "textDocument/didOpen",
              params: { textDocument: { uri: documentUri, languageId: "kotlin", version: 1, text: documentText } },
            })
            continue
          }
          clearTimeout(timer)
          resolve(`${capabilities} capabilities`)
        }
      })
    })
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: process.pid,
        rootUri: pathToFileURL(temporary).href,
        capabilities: {},
        workspaceFolders: null,
        clientInfo: { name: "opencode-offline-check", version: "1" },
      },
    })
    try {
      console.log(`${name}: initialize OK (${await response})`)
    } finally {
      child.kill("SIGTERM")
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

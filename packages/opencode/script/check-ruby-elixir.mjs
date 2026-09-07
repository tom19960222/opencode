import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"

const assets = path.resolve(process.argv[2] ?? "assets")
const root = await mkdtemp(path.join(os.tmpdir(), "opencode-lsp-offline-"))
await mkdir(path.join(root, "home"))
for (const name of ["rubocop", "elixir-ls"]) {
  const directory = path.join(root, name)
  await mkdir(directory)
  if (name === "rubocop") await writeFile(path.join(directory, "example.rb"), "puts 'offline'\n")
  if (name === "elixir-ls") {
    await mkdir(path.join(directory, "lib"))
    await writeFile(path.join(directory, "mix.exs"), `defmodule Offline.MixProject do\n  use Mix.Project\n  def project, do: [app: :offline, version: "0.1.0", deps: []]\n  def application, do: [extra_applications: [:logger]]\nend\n`)
    await writeFile(path.join(directory, "lib", "offline.ex"), "defmodule Offline do\n  def hello, do: :world\nend\n")
  }
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(assets, "bin", name), name === "rubocop" ? ["--lsp"] : [], {
      cwd: directory,
      env: { ...process.env, HOME: path.join(root, "home"), ERL_FLAGS: "+S 4:4", PATH: `${path.join(assets, "bin")}:${process.env.PATH}`, HEX_OFFLINE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    let buffered = Buffer.alloc(0)
    let error = ""
    let initialized = false
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${name} initialize timed out: ${error}`)) }, 60_000)
    const send = (message) => {
      const body = JSON.stringify({ jsonrpc: "2.0", ...message })
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    }
    child.on("error", reject)
    child.stderr.on("data", (bytes) => { error = (error + bytes.toString()).slice(-16_000) })
    child.stdout.on("data", (bytes) => {
      buffered = Buffer.concat([buffered, bytes])
      while (true) {
        const separator = buffered.indexOf("\r\n\r\n")
        if (separator < 0) return
        const length = /Content-Length:\s*(\d+)/i.exec(buffered.subarray(0, separator).toString())
        if (!length || buffered.length < separator + 4 + Number(length[1])) return
        const message = JSON.parse(buffered.subarray(separator + 4, separator + 4 + Number(length[1])).toString())
        buffered = buffered.subarray(separator + 4 + Number(length[1]))
        if (message.id === 1) {
          if (!message.result?.capabilities) { child.kill(); reject(new Error(`${name}: ${JSON.stringify(message)}`)); return }
          initialized = true
          send({ method: "initialized", params: {} })
          send({ id: 2, method: "shutdown", params: null })
        }
        if (message.id === 2) send({ method: "exit", params: null })
      }
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      if (!initialized || code !== 0) { reject(new Error(`${name} exited ${code}: ${error}`)); return }
      console.log(`${name}: initialize, shutdown, exit passed with fresh HOME`)
      resolve()
    })
    send({ id: 1, method: "initialize", params: { processId: process.pid, rootUri: new URL(`file://${directory}`).href, capabilities: {}, workspaceFolders: [{ uri: new URL(`file://${directory}`).href, name: "offline" }] } })
  })
}

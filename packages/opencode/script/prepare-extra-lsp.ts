#!/usr/bin/env bun

import path from "node:path"
import { mkdir, chmod, symlink, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import versions from "./air-gap-extra-lsp-versions.json"

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("These pinned LSP bundles target Linux x64")
const dir = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dirname, "../assets"))
const cache = process.env.OPENCODE_AIR_GAP_DOWNLOAD_DIR ?? path.join(dir, ".downloads")
await mkdir(path.join(dir, "bin"), { recursive: true })

for (const item of versions) {
  const dest = path.join(dir, "native", item.name)
  const record = Bun.file(path.join(dest, "opencode-resource.json"))
  if ((await record.exists()) && (await record.json()).sha256 === item.sha256) continue
  const archivePath = path.join(cache, item.archive)
  const archive = Bun.file(archivePath)
  if (!(await archive.exists())) {
    const response = await fetch(item.url)
    if (!response.ok) throw new Error(`${item.name}: HTTP ${response.status}`)
    await Bun.write(archive, await response.arrayBuffer())
  }
  if (
    createHash("sha256")
      .update(await archive.bytes())
      .digest("hex") !== item.sha256
  ) {
    throw new Error(`Checksum mismatch: ${item.name}`)
  }
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  const child = Bun.spawn(
    item.archive.endsWith(".zip")
      ? ["unzip", "-q", "-o", archivePath, "-d", dest]
      : ["tar", "-xf", archivePath, "--strip-components=1", "-C", dest],
    { stdout: "inherit", stderr: "inherit" },
  )
  if ((await child.exited) !== 0) throw new Error(`Extraction failed: ${item.name}`)
  await Bun.write(record, JSON.stringify(item, null, 2) + "\n")
  if (!process.env.OPENCODE_AIR_GAP_DOWNLOAD_DIR) await rm(archivePath)
}

const java = (
  await Array.fromAsync(new Bun.Glob("extension/jre/*/bin/java").scan({ cwd: path.join(dir, "native/jdtls") }))
)[0]
if (!java) throw new Error("The Java distribution must include its JVM")
const links = {
  "vscode-eslint": "../native/vscode-eslint/extension",
  jdtls: "../native/jdtls/extension/server",
  java: `../native/jdtls/${java}`,
}
for (const [name, target] of Object.entries(links)) {
  await rm(path.join(dir, "bin", name), { force: true })
  await symlink(target, path.join(dir, "bin", name))
}
await chmod(path.join(dir, "bin/java"), 0o755)
await rm(path.join(dir, "bin/kotlin-ls"), { force: true })
await Bun.write(
  path.join(dir, "bin/kotlin-language-server"),
  `#!/bin/sh
set -eu
opencode_assets=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export JAVA_HOME="$opencode_assets/native/jdtls/${path.dirname(path.dirname(java))}"
exec "$opencode_assets/native/kotlin-ls/server/bin/kotlin-language-server" "$@"
`,
)
await chmod(path.join(dir, "bin/kotlin-language-server"), 0o755)
await chmod(path.join(dir, "native/kotlin-ls/server/bin/kotlin-language-server"), 0o755)
await Bun.write(
  path.join(dir, "native/kotlin-ls/LICENSE.txt"),
  Bun.file(path.join(import.meta.dirname, "licenses/kotlin-lsp-LICENSE.txt")),
)
await Bun.write(path.join(dir, "extra-lsp-manifest.json"), JSON.stringify(versions, null, 2) + "\n")
console.log("Prepared ESLint, JDTLS with JVM, and Kotlin language servers")

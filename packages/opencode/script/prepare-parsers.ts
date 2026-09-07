#!/usr/bin/env bun

import { createHash } from "node:crypto"
import path from "node:path"
import { config } from "../../tui/src/parsers-config"

const dir = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dirname, "../assets"), "parsers")
const sources = [...new Set(config.parsers.flatMap((parser) => [parser.wasm, ...Object.values(parser.queries).flat()]))]
const manifest: Record<string, { file: string; sha256: string; bytes: number }> = {}

// nvim queries can inherit other language queries. Expand those at provisioning
// time so the runtime needs neither network access nor an inheritance resolver.
async function download(source: string, parents: string[] = []): Promise<Uint8Array> {
  if (parents.includes(source)) throw new Error(`Circular parser query inheritance: ${source}`)
  const response = await fetch(source)
  if (!response.ok) throw new Error(`Failed to provision ${source}: HTTP ${response.status}`)
  if (source.endsWith(".wasm")) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!WebAssembly.validate(bytes)) throw new Error(`Invalid parser WASM: ${source}`)
    return bytes
  }
  const text = await response.text()
  const inherited = [...text.matchAll(/^;+\s*inherits:\s*(.+)$/gm)].flatMap((match) =>
    match[1].split(",").map((name) => name.trim().replace(/[()]/g, "")),
  )
  const queries = await Promise.all(
    inherited.map((name) =>
      download(new URL(`../${name}/${path.basename(source)}`, source).href, [...parents, source]),
    ),
  )
  return new TextEncoder().encode([...queries.map((query) => new TextDecoder().decode(query)), text].join("\n"))
}

for (const batch of Array.from({ length: Math.ceil(sources.length / 6) }, (_, i) => sources.slice(i * 6, i * 6 + 6))) {
  await Promise.all(
    batch.map(async (source) => {
      const file = createHash("sha256").update(source).digest("hex") + path.extname(new URL(source).pathname)
      const bytes = await download(source)
      await Bun.write(path.join(dir, file), bytes)
      manifest[source] = { file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }
      console.log(`Prepared ${source}`)
    }),
  )
}
await Bun.write(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log(`Prepared ${sources.length} parser assets in ${dir}`)

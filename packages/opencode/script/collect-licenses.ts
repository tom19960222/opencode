#!/usr/bin/env bun
import path from "node:path"
import { copyFile, mkdir } from "node:fs/promises"

const root = path.resolve(import.meta.dirname, "../../..")
const assets = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dirname, "../assets"))
const output = path.join(assets, "licenses", "npm")
const files: string[] = []

// Keep a conservative superset of installed dependency notices, including
// nested font/data licenses and build-time dependencies used by the web bundle.
for (const [name, directory] of Object.entries({
  dependencies: path.join(root, "node_modules/.bun"),
  tools: path.join(assets, "cache"),
})) {
  for await (const file of new Bun.Glob("**/*").scan({ cwd: directory, dot: true, followSymlinks: false })) {
    if (!/^(licen[sc]e|notice|copying|ofl)([._-].*)?$/i.test(path.basename(file))) continue
    const target = path.join(output, name, file)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(path.join(directory, file), target)
    files.push(path.join(name, file))
  }
}
await Bun.write(path.join(output, "manifest.json"), JSON.stringify({ files: files.sort() }, null, 2) + "\n")
console.log(`Collected ${files.length} dependency notices in ${output}`)

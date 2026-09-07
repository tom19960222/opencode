#!/usr/bin/env bun

import path from "node:path"
import { config } from "../../tui/src/parsers-config"

const dir = path.resolve(
  process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dirname, "../assets"),
  "licenses/parsers",
)
const sources = config.parsers.flatMap((parser) => [parser.wasm, ...Object.values(parser.queries).flat()])
const repos = [
  ...new Set([
    ...sources.map((source) => new URL(source).pathname.split("/").slice(1, 3).join("/")),
    "nix-community/tree-sitter-nix",
  ]),
]
const manifest: Record<string, string> = {}
for (const repo of repos) {
  const release = sources
    .find((source) => source.includes(`${repo}/releases/download/`))
    ?.split("/releases/download/")[1]
    .split("/")[0]
  const refs = [...new Set([release, "master", "main"].filter((ref): ref is string => !!ref))]
  const found = await (async () => {
    for (const ref of refs) {
      for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.txt"]) {
        const url = `https://raw.githubusercontent.com/${repo}/${ref}/${name}`
        const response = await fetch(url)
        if (response.status === 404) continue
        if (!response.ok) throw new Error(`Cannot download license ${url}: ${response.status}`)
        await Bun.write(path.join(dir, repo, name), await response.text())
        manifest[repo] = url
        return true
      }
    }
    return false
  })()
  if (!found) throw new Error(`No license found for parser source ${repo}`)
  console.log(`Licensed ${repo}`)
}
await Bun.write(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")

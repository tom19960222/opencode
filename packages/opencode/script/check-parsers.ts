#!/usr/bin/env bun

import { createHash } from "node:crypto"
import path from "node:path"
import { Parser, Language, Query } from "web-tree-sitter"
import { config } from "../../tui/src/parsers-config"

const dir = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dirname, "../assets"), "parsers")
const manifest = await Bun.file(path.join(dir, "manifest.json")).json()
await Parser.init()
for (const parser of config.parsers) {
  const source = (url: string) => path.join(dir, manifest[url].file)
  for (const url of [parser.wasm, ...Object.values(parser.queries).flat()]) {
    const bytes = await Bun.file(source(url)).bytes()
    if (createHash("sha256").update(bytes).digest("hex") !== manifest[url].sha256) {
      throw new Error(`Parser integrity check failed: ${url}`)
    }
  }
  const language = await Language.load(source(parser.wasm))
  for (const [kind, urls] of Object.entries(parser.queries)) {
    const query = new Query(
      language,
      (await Promise.all(urls.map((url: string) => Bun.file(source(url)).text()))).join("\n"),
    )
    query.delete()
    console.log(`${parser.filetype}: ${kind} OK`)
  }
  const instance = new Parser()
  instance.setLanguage(language)
  const tree = instance.parse("hello world")
  if (!tree) throw new Error(`Failed to parse ${parser.filetype}`)
  tree.delete()
  instance.delete()
}

#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { TreeSitterClient, addDefaultParsers } from "@opentui/core"

process.env.OPENCODE_AIR_GAPPED = "on"
process.env.OPENCODE_AIR_GAP_DIR ??= path.join(import.meta.dirname, "../assets")
const { default: parsers } = await import("../../tui/src/parsers-config")
addDefaultParsers(parsers.parsers)
const dir = await mkdtemp(path.join(tmpdir(), "opencode-parsers-"))
const client = new TreeSitterClient({ dataPath: dir })
try {
  await client.initialize()
  for (const parser of parsers.parsers) {
    if (!(await client.preloadParser(parser.filetype))) throw new Error(`Cannot preload ${parser.filetype}`)
  }
  for (const [filetype, content] of Object.entries({
    python: "def hello():\n    return 42",
    javascript: "const hello = 42;",
    typescript: "const hello: number = 42;",
    markdown: "# hello\n**world**",
    markdown_inline: "**hello**",
    zig: "const hello: u32 = 42;",
  })) {
    const result = await client.highlightOnce(content, filetype)
    if (result.error || !result.highlights?.length) throw new Error(`${filetype}: ${JSON.stringify(result)}`)
    console.log(`${filetype}: ${result.highlights.length} highlights`)
  }
} finally {
  await client.destroy()
  await rm(dir, { recursive: true, force: true })
}

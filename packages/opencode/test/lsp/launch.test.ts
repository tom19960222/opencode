import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { spawn } from "../../src/lsp/launch"
import { tmpdir } from "../fixture/fixture"

describe("lsp.launch", () => {
  test("airgap child launch uses bundled tools and disables automatic dependency acquisition", async () => {
    const previous = { mode: process.env.OPENCODE_AIR_GAPPED, directory: process.env.OPENCODE_AIR_GAP_DIR }
    process.env.OPENCODE_AIR_GAPPED = "1"
    process.env.OPENCODE_AIR_GAP_DIR = "/tmp/airgap-test-assets"
    try {
      const proc = spawn(
        process.execPath,
        [
          "-e",
          `
        const assert = require("node:assert/strict")
        assert.equal(process.env.GOPROXY, "off")
        assert.equal(process.env.GOTOOLCHAIN, "local")
        assert.equal(process.env.CARGO_NET_OFFLINE, "true")
        assert.equal(process.env.CHECKPOINT_DISABLE, "1")
        assert.equal(process.env.PATH.split(require("node:path").delimiter)[0], "/tmp/airgap-test-assets/bin")
      `,
        ],
        { env: { ...process.env, GOPROXY: "https://example.invalid" } },
      )
      expect(await proc.exited).toBe(0)
    } finally {
      if (previous.mode === undefined) delete process.env.OPENCODE_AIR_GAPPED
      else process.env.OPENCODE_AIR_GAPPED = previous.mode
      if (previous.directory === undefined) delete process.env.OPENCODE_AIR_GAP_DIR
      else process.env.OPENCODE_AIR_GAP_DIR = previous.directory
    }
  })
  test("spawns cmd scripts with spaces on Windows", async () => {
    if (process.platform !== "win32") return

    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "with space")
    const file = path.join(dir, "echo cmd.cmd")

    await fs.mkdir(dir, { recursive: true })
    await Bun.write(file, "@echo off\r\nif %~1==--stdio exit /b 0\r\nexit /b 7\r\n")

    const proc = spawn(file, ["--stdio"])

    expect(await proc.exited).toBe(0)
  })
})

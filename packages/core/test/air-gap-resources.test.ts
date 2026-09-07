import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { AirGap } from "../src/air-gap"
import { Npm } from "../src/npm"
import { which } from "../src/util/which"
import { tmpdir } from "./fixture/tmpdir"

test("air-gapped resources and npm resolve from the prepared bundle without downloading", async () => {
  await using tmp = await tmpdir()
  const previous = { mode: process.env.OPENCODE_AIR_GAPPED, directory: process.env.OPENCODE_AIR_GAP_DIR }
  process.env.OPENCODE_AIR_GAPPED = "1"
  process.env.OPENCODE_AIR_GAP_DIR = tmp.path
  try {
    const url = "https://unreachable.invalid/../../resource?path=/etc/passwd"
    await mkdir(path.dirname(AirGap.resource(url)), { recursive: true })
    await writeFile(AirGap.resource(url), "prepared resource")
    expect((await AirGap.read(url)).toString("utf8")).toBe("prepared resource")
    expect(path.dirname(AirGap.resource(url))).toBe(path.join(tmp.path, "resources"))
    await expect(AirGap.read("https://unreachable.invalid/missing")).rejects.toThrow("Prepackage")

    const directory = path.join(tmp.path, "cache", "packages", "fixture-offline", "node_modules", "fixture-offline")
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "fixture-offline", main: "index.js" }))
    await writeFile(path.join(directory, "index.js"), "export default true")
    expect((await Npm.add("fixture-offline")).directory).toBe(directory)
    await expect(Npm.add("fixture-offline-missing@1.0.0")).rejects.toThrow()

    await mkdir(path.join(tmp.path, "bin"))
    const command = path.join(tmp.path, "bin", "fixture-offline-command")
    await writeFile(command, "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    expect(which("fixture-offline-command")).toBe(command)
  } finally {
    if (previous.mode === undefined) delete process.env.OPENCODE_AIR_GAPPED
    else process.env.OPENCODE_AIR_GAPPED = previous.mode
    if (previous.directory === undefined) delete process.env.OPENCODE_AIR_GAP_DIR
    else process.env.OPENCODE_AIR_GAP_DIR = previous.directory
  }
})

import assert from "node:assert/strict"
import path from "node:path"
import { mkdtemp, mkdir, writeFile, chmod, rm, readdir, copyFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const dir = await mkdtemp(path.join(tmpdir(), "opencode-launcher-"))
try {
  await mkdir(path.join(dir, "assets/node_modules"), { recursive: true })
  await mkdir(path.join(dir, "bin"))
  await writeFile(path.join(dir, "assets/node_modules/marker"), "local-assets\n")
  await writeFile(path.join(dir, "bin/opencode"), '#!/bin/sh\ncat "$OPENCODE_AIR_GAP_DIR/node_modules/marker"\n')
  await chmod(path.join(dir, "bin/opencode"), 0o755)
  await copyFile(fileURLToPath(new URL("./air-gap-launcher.cjs", import.meta.url)), path.join(dir, "bin/opencode.cjs"))
  execFileSync("tar", ["-czf", "assets.tar.gz", "assets"], { cwd: dir })
  const digest = createHash("sha256")
    .update(await readFile(path.join(dir, "assets.tar.gz")))
    .digest("hex")
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ opencodeAssetsSha256: digest }))
  const run = (env = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(dir, "bin/opencode.cjs")], {
        env: {
          ...process.env,
          OPENCODE_AIR_GAPPED: "on",
          OPENCODE_AIR_GAP_DIR: "",
          XDG_CACHE_HOME: path.join(dir, "cache"),
          ...env,
        },
      })
      let out = ""
      let err = ""
      child.stdout.on("data", (chunk) => {
        out += chunk
      })
      child.stderr.on("data", (chunk) => {
        err += chunk
      })
      child.on("error", reject)
      child.on("close", (code) => resolve({ code, out, err }))
    })
  const results = await Promise.all([run(), run(), run()])
  results.forEach((result) => {
    assert.equal(result.code, 0, result.err)
    assert.equal(result.out, "local-assets\n")
  })
  assert.deepEqual(await readdir(path.join(dir, "cache/opencode/air-gap")), [digest])
  await writeFile(path.join(dir, "assets.tar.gz"), "corrupt")
  assert.equal((await run()).code, 0, "complete cache survives missing/corrupt installer archive")
  const bad = await run({ XDG_CACHE_HOME: path.join(dir, "empty-cache") })
  assert.equal(bad.code, 1)
  assert.match(bad.err, /checksum mismatch/)
  assert.equal((await run({ OPENCODE_AIR_GAP_DIR: path.join(dir, "assets") })).code, 0)
  console.log("Node launcher: concurrent extraction, cache reuse, digest rejection, explicit assets passed")
} finally {
  await rm(dir, { recursive: true, force: true })
}

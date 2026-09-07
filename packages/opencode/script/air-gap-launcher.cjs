#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const crypto = require("node:crypto")
const childProcess = require("node:child_process")

async function main() {
  const root = path.resolve(__dirname, "..")
  if (
    ["1", "true", "on"].includes((process.env.OPENCODE_AIR_GAPPED || "").toLowerCase()) &&
    !process.env.OPENCODE_AIR_GAP_DIR
  ) {
    const digest = require(path.join(root, "package.json")).opencodeAssetsSha256
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid offline asset digest in package.json")
    const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "opencode", "air-gap")
    const target = path.join(cache, digest)
    if (!fs.existsSync(path.join(target, "assets"))) {
      const archive = path.join(root, "assets.tar.gz")
      const hash = crypto.createHash("sha256")
      for await (const chunk of fs.createReadStream(archive)) hash.update(chunk)
      if (hash.digest("hex") !== digest) throw new Error("Offline asset archive checksum mismatch")
      fs.mkdirSync(cache, { recursive: true, mode: 0o700 })
      const temporary = fs.mkdtempSync(path.join(cache, ".unpack-"))
      try {
        childProcess.execFileSync("tar", ["-xzf", archive, "-C", temporary], { stdio: "inherit" })
        try {
          fs.renameSync(temporary, target)
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes(error.code) || !fs.existsSync(path.join(target, "assets"))) throw error
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true })
      }
    }
    process.env.OPENCODE_AIR_GAP_DIR = path.join(target, "assets")
  }
  const child = childProcess.spawn(path.join(root, "bin", "opencode"), process.argv.slice(2), { stdio: "inherit" })
  const forwarders = {}
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    forwarders[signal] = () => child.kill(signal)
    process.on(signal, forwarders[signal])
  }
  child.on("error", (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    for (const [name, listener] of Object.entries(forwarders)) process.removeListener(name, listener)
    if (signal) return process.kill(process.pid, signal)
    process.exit(code ?? 1)
  })
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

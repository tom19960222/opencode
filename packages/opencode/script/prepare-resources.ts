// Run on the connected build machine. Runtime reads these resources without a registry or GitHub request.
import path from "node:path"
import locks from "./air-gap-npm-locks.json"
import { mkdir, copyFile, chmod, rm } from "node:fs/promises"
import { createHash } from "node:crypto"

const directory = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dir, "../assets"))
const packages = [
  ...Object.keys(locks),
  ...(process.env.OPENCODE_AIR_GAP_NPM_PACKAGES?.split(",").filter(Boolean) ?? []),
]

await mkdir(path.join(directory, "bin"), { recursive: true })
const platform = process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-musl"
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
  throw new Error("Prepare resources on the target Linux architecture")
}
const archive = path.join(directory, "ripgrep.tar.gz")
const response = await fetch(
  `https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-${platform}.tar.gz`,
)
if (!response.ok) throw new Error(`ripgrep download failed: ${response.status}`)
await Bun.write(archive, response)
const extraction = Bun.spawn(["tar", "-xzf", archive, "-C", directory], { stdout: "inherit", stderr: "inherit" })
if ((await extraction.exited) !== 0) throw new Error("ripgrep extraction failed")
await copyFile(path.join(directory, `ripgrep-15.1.0-${platform}`, "rg"), path.join(directory, "bin", "rg"))
await chmod(path.join(directory, "bin", "rg"), 0o755)
await rm(archive)
await rm(path.join(directory, `ripgrep-15.1.0-${platform}`), { recursive: true })

for (const spec of packages) {
  const target = path.join(directory, "cache", "packages", spec)
  if (!target.startsWith(path.join(directory, "cache", "packages") + path.sep))
    throw new Error(`Invalid package: ${spec}`)
  if (await Bun.file(path.join(target, "node_modules", ".package-lock.json")).exists()) continue
  await mkdir(target, { recursive: true })
  const locked = locks[spec as keyof typeof locks]
  await Bun.write(path.join(target, "package.json"), JSON.stringify({ private: true, ...locked?.packages[""] }))
  if (locked) await Bun.write(path.join(target, "package-lock.json"), JSON.stringify(locked))
  const child = Bun.spawn(
    locked
      ? ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]
      : ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", spec],
    {
      cwd: target,
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, npm_config_cache: path.join(directory, "npm-cache") },
    },
  )
  if ((await child.exited) !== 0) throw new Error(`Failed to prepackage ${spec}`)
}

// Supply URLs for configured remote config and skill indexes/files, one URL per line.
if (process.env.OPENCODE_AIR_GAP_RESOURCE_LIST) {
  const urls = (await Bun.file(process.env.OPENCODE_AIR_GAP_RESOURCE_LIST).text()).split(/\r?\n/).filter(Boolean)
  await mkdir(path.join(directory, "resources"), { recursive: true })
  for (const url of urls) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Resource download failed (${response.status}): ${url}`)
    await Bun.write(path.join(directory, "resources", createHash("sha256").update(url).digest("hex")), response)
  }
}
await mkdir(path.join(directory, "licenses", "ripgrep"), { recursive: true })
for (const file of ["COPYING", "LICENSE-MIT", "UNLICENSE"]) {
  const response = await fetch(`https://raw.githubusercontent.com/BurntSushi/ripgrep/15.1.0/${file}`)
  if (!response.ok) throw new Error(`Missing ripgrep license ${file}: ${response.status}`)
  await Bun.write(path.join(directory, "licenses", "ripgrep", file), response)
}
const manifest = await Promise.all(
  packages.map(async (spec) => {
    const lock = await Bun.file(path.join(directory, "cache", "packages", spec, "package-lock.json")).json()
    return { spec, packages: lock.packages }
  }),
)
await Bun.write(path.join(directory, "npm-manifest.json"), JSON.stringify(manifest, null, 2))
await rm(path.join(directory, "npm-cache"), { recursive: true, force: true })
console.log(`Prepared local runtime resources in ${directory}`)

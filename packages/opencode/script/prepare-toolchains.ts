// Connected build step. Keep the extracted SDK trees: their binaries locate standard libraries relative to them.
import path from "node:path"
import versions from "./air-gap-native-versions.json"
import { mkdir, chmod, symlink, rm, copyFile } from "node:fs/promises"
import { createHash } from "node:crypto"

if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
  throw new Error("Build on target Linux architecture")
const directory = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dir, "../assets"))
const arch = process.arch === "arm64" ? "arm64" : "amd64"
const targets: { name: string; version: string; url: string; sha256?: string; commands: string[] }[] = []
const goResponse = await fetch("https://go.dev/dl/?mode=json&include=all")
if (!goResponse.ok) throw new Error(`Go release metadata: ${goResponse.status}`)
const go = (
  (await goResponse.json()) as {
    version: string
    files: { filename: string; os: string; arch: string; kind: string; sha256: string }[]
  }[]
).find((item) => item.version === versions.go.version)!
const goArchive = go.files.find((file) => file.os === "linux" && file.arch === arch && file.kind === "archive")!
targets.push({
  name: "go",
  version: go.version,
  url: `https://go.dev/dl/${goArchive.filename}`,
  sha256: goArchive.sha256,
  commands: ["go", "gofmt"],
})
const zigResponse = await fetch("https://ziglang.org/download/index.json")
if (!zigResponse.ok) throw new Error(`Zig release metadata: ${zigResponse.status}`)
const zigIndex = (await zigResponse.json()) as Record<string, Record<string, { tarball: string; shasum: string }>>
const zigVersion = versions.zig.version
const zig = zigIndex[zigVersion]![`${process.arch === "arm64" ? "aarch64" : "x86_64"}-linux`]!
targets.push({ name: "zig", version: zigVersion, url: zig.tarball, sha256: zig.shasum, commands: ["zig"] })
for (const name of ["terraform", "terraform-ls"]) {
  const pinned = versions[name as "terraform" | "terraform-ls"]
  targets.push({
    name,
    version: pinned.version,
    url: `https://releases.hashicorp.com/${name}/${pinned.version}/${name}_${pinned.version}_linux_${arch}.zip`,
    sha256: process.arch === "x64" ? pinned.sha256 : undefined,
    commands: [name],
  })
}
await mkdir(path.join(directory, "bin"), { recursive: true })
const records = []
for (const target of targets) {
  const dest = path.join(directory, "native", target.name)
  const record = Bun.file(path.join(dest, "opencode-resource.json"))
  if (await record.exists()) {
    records.push(await record.json())
    continue
  }
  console.log(`Preparing ${target.name} ${target.version}`)
  const response = await fetch(target.url)
  if (!response.ok) throw new Error(`${target.url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (target.sha256 && target.sha256 !== sha256) throw new Error(`Checksum mismatch for ${target.name}`)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  const archive = path.join(dest, path.basename(new URL(target.url).pathname))
  await Bun.write(archive, bytes)
  const child = Bun.spawn(
    archive.endsWith(".zip") ? ["unzip", "-q", archive, "-d", dest] : ["tar", "-xf", archive, "-C", dest],
    { stdout: "inherit", stderr: "inherit" },
  )
  if ((await child.exited) !== 0) throw new Error(`Failed extracting ${target.name}`)
  await rm(archive)
  for (const command of target.commands) {
    const matches = await Array.fromAsync(
      new Bun.Glob(`**/${command}`).scan({ cwd: dest, absolute: true, onlyFiles: true }),
    )
    const executable = matches.find((file) => (target.name === "go" ? file.includes("/go/bin/") : true))
    if (!executable) throw new Error(`Missing executable: ${command}`)
    await chmod(executable, 0o755)
    await rm(path.join(directory, "bin", command), { force: true })
    await symlink(path.relative(path.join(directory, "bin"), executable), path.join(directory, "bin", command))
  }
  const metadata = { name: target.name, version: target.version, source: target.url, sha256 }
  await Bun.write(record, JSON.stringify(metadata, null, 2))
  records.push(metadata)
}
const goplsRecord = Bun.file(path.join(directory, "native", "gopls", "opencode-resource.json"))
if (await goplsRecord.exists()) records.push(await goplsRecord.json())
else {
  const version = versions.gopls.version
  console.log(`Building gopls ${version}`)
  const build = path.join(directory, ".go-build")
  const child = Bun.spawn([path.join(directory, "bin", "go"), "install", `golang.org/x/tools/gopls@${version}`], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      GOTOOLCHAIN: "local",
      GOBIN: path.join(directory, "bin"),
      GOPATH: build,
      GOCACHE: path.join(build, "cache"),
      CGO_ENABLED: "0",
    },
  })
  if ((await child.exited) !== 0) throw new Error("Failed building gopls")
  const dest = path.join(directory, "native", "gopls")
  await mkdir(dest, { recursive: true })
  const licenses = await Array.fromAsync(
    new Bun.Glob("pkg/mod/golang.org/x/tools*/LICENSE").scan({ cwd: build, absolute: true, onlyFiles: true }),
  )
  if (!licenses[0]) throw new Error("Missing gopls license")
  await copyFile(licenses[0], path.join(dest, "LICENSE"))
  const metadata = {
    name: "gopls",
    version,
    source: `golang.org/x/tools/gopls@${version}`,
    sha256: createHash("sha256")
      .update(await Bun.file(path.join(directory, "bin", "gopls")).bytes())
      .digest("hex"),
  }
  await Bun.write(goplsRecord, JSON.stringify(metadata, null, 2))
  records.push(metadata)
}
const notices = path.join(directory, "licenses", "gopls")
if (!(await Bun.file(path.join(notices, "build-info.txt")).exists())) {
  const inspect = Bun.spawn([path.join(directory, "bin", "go"), "version", "-m", path.join(directory, "bin", "gopls")])
  const info = await new Response(inspect.stdout).text()
  if ((await inspect.exited) !== 0) throw new Error("Cannot inspect gopls module dependencies")
  await mkdir(notices, { recursive: true })
  for (const line of info.split("\n")) {
    const fields = line.trim().split("\t")
    if (!["mod", "dep"].includes(fields[0]!) || !fields[2]?.startsWith("v")) continue
    const module = fields[1]!
    const version = fields[2]
    const source = `https://proxy.golang.org/${module.replace(/[A-Z]/g, (char) => "!" + char.toLowerCase())}/@v/${version}.zip`
    const archive = path.join(directory, ".gopls-notices.zip")
    console.log(`Collecting notice: ${module}@${version}`)
    const download = Bun.spawn(
      [
        "curl",
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        "60",
        "--retry",
        "2",
        "--output",
        archive,
        source,
      ],
      { stdout: "inherit", stderr: "inherit" },
    )
    if ((await download.exited) !== 0) throw new Error(`Cannot acquire gopls dependency notices: ${source}`)
    const listing = Bun.spawn(["unzip", "-Z1", archive])
    const files = (await new Response(listing.stdout).text()).split("\n")
    if ((await listing.exited) !== 0) throw new Error(`Cannot inspect ${module} notices`)
    for (const file of files.filter((file) =>
      /^(LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)([._-]|$)/i.test(path.basename(file)),
    )) {
      const dest = path.resolve(notices, file)
      if (!dest.startsWith(notices + path.sep)) throw new Error("Invalid dependency notice path")
      const extraction = Bun.spawn(["unzip", "-p", archive, file])
      await Bun.write(dest, await new Response(extraction.stdout).arrayBuffer())
      if ((await extraction.exited) !== 0) throw new Error(`Cannot extract ${file}`)
    }
    await rm(archive)
  }
  await Bun.write(path.join(notices, "build-info.txt"), info)
}
const cleanup = Bun.spawn([path.join(directory, "bin", "go"), "clean", "-modcache", "-cache"], {
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    GOPATH: path.join(directory, ".go-build"),
    GOCACHE: path.join(directory, ".go-build", "cache"),
    GOTOOLCHAIN: "local",
  },
})
if ((await cleanup.exited) !== 0) throw new Error("Failed to clean Go build cache")
await rm(path.join(directory, ".go-build"), { recursive: true, force: true })
await Bun.write(path.join(directory, "toolchain-manifest.json"), JSON.stringify(records, null, 2))

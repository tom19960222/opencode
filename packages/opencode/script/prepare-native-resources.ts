// Connected build step for standalone native language/format tools. Full language SDKs remain project prerequisites.
import path from "node:path"
import versions from "./air-gap-native-versions.json"
import { mkdir, chmod, symlink, stat, rm } from "node:fs/promises"
import { createHash } from "node:crypto"

if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
  throw new Error("Build on target Linux architecture")
const directory = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dir, "../assets"))
const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
const tools = [
  { name: "deno", repo: "denoland/deno", asset: new RegExp(`^deno-${arch}-unknown-linux-gnu.zip$`) },
  { name: "zls", repo: "zigtools/zls", asset: new RegExp(`^zls-${arch}-linux.tar.xz$`) },
  {
    name: "rust-analyzer",
    repo: "rust-lang/rust-analyzer",
    asset: new RegExp(`^rust-analyzer-${arch}-unknown-linux-gnu.gz$`),
  },
  {
    name: "clangd",
    repo: "clangd/clangd",
    asset: new RegExp(`^clangd-linux-${process.arch === "arm64" ? "arm64-" : ""}[0-9][^/]*\\.zip$`),
  },
  {
    name: "shfmt",
    repo: "mvdan/sh",
    asset: new RegExp(`^shfmt_v[^/]+_linux_${process.arch === "arm64" ? "arm64" : "amd64"}$`),
  },
  {
    name: "lua-language-server",
    repo: "LuaLS/lua-language-server",
    asset: new RegExp(`^lua-language-server-[^/]+-linux-${process.arch}.tar.gz$`),
  },
  { name: "texlab", repo: "latex-lsp/texlab", asset: new RegExp(`^texlab-${arch}-linux.tar.gz$`) },
  {
    name: "tinymist",
    repo: "Myriad-Dreamin/tinymist",
    asset: new RegExp(`^tinymist-${arch}-unknown-linux-gnu.tar.gz$`),
  },
]
await mkdir(path.join(directory, "bin"), { recursive: true })
const records = []
for (const tool of tools) {
  const dest = path.join(directory, "native", tool.name)
  const record = Bun.file(path.join(dest, "opencode-resource.json"))
  if (await record.exists()) {
    records.push(await record.json())
    continue
  }
  const pinned = versions[tool.name as keyof typeof versions]
  const response = await fetch(
    `https://api.github.com/repos/${tool.repo}/releases/tags/${encodeURIComponent(pinned.version)}`,
  )
  if (!response.ok) throw new Error(`${tool.repo}: ${response.status}`)
  const release = (await response.json()) as {
    tag_name: string
    assets: { name: string; browser_download_url: string }[]
  }
  const asset = release.assets.find((asset) => tool.asset.test(asset.name))
  if (!asset)
    throw new Error(`No ${tool.name} asset for ${arch}: ${release.assets.map((asset) => asset.name).join(", ")}`)
  console.log(`Preparing ${tool.name} ${release.tag_name}`)
  const download = await fetch(asset.browser_download_url)
  if (!download.ok) throw new Error(`${asset.browser_download_url}: ${download.status}`)
  const bytes = new Uint8Array(await download.arrayBuffer())
  if (process.arch === "x64" && createHash("sha256").update(bytes).digest("hex") !== pinned.sha256)
    throw new Error(`Checksum mismatch: ${tool.name}`)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  const archive = path.join(dest, asset.name)
  if (asset.name.endsWith(".tar.gz") || asset.name.endsWith(".tar.xz") || asset.name.endsWith(".zip")) {
    await Bun.write(archive, bytes)
    const child = Bun.spawn(
      asset.name.endsWith(".zip") ? ["unzip", "-q", archive, "-d", dest] : ["tar", "-xf", archive, "-C", dest],
      { stdout: "inherit", stderr: "inherit" },
    )
    if ((await child.exited) !== 0) throw new Error(`Failed extracting ${tool.name}`)
    await rm(archive)
  } else {
    await Bun.write(path.join(dest, tool.name), asset.name.endsWith(".gz") ? Bun.gunzipSync(bytes) : bytes)
  }
  const matches = await Array.fromAsync(
    new Bun.Glob(`**/${tool.name}`).scan({ cwd: dest, absolute: true, onlyFiles: true }),
  )
  const executable = matches.find((file) => !file.includes("/share/"))
  if (!executable || !(await stat(executable)).isFile()) throw new Error(`No executable for ${tool.name}`)
  await chmod(executable, 0o755)
  await rm(path.join(directory, "bin", tool.name), { force: true })
  await symlink(path.relative(path.join(directory, "bin"), executable), path.join(directory, "bin", tool.name))
  const metadata = {
    name: tool.name,
    version: release.tag_name,
    source: asset.browser_download_url,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    repository: `https://github.com/${tool.repo}`,
  }
  await Bun.write(record, JSON.stringify(metadata, null, 2))
  records.push(metadata)
}
for (const record of records) {
  const tool = tools.find((tool) => tool.name === record.name)!
  const response = await fetch(
    `https://api.github.com/repos/${tool.repo}/license?ref=${encodeURIComponent(record.version)}`,
  )
  const license = response.ok
    ? ((await response.json()) as { content: string; license: { spdx_id: string }; html_url: string })
    : undefined
  if (license) {
    await Bun.write(
      path.join(directory, "native", tool.name, "LICENSE.repository"),
      Buffer.from(license.content, "base64"),
    )
    record.license = license.license.spdx_id
    record.licenseSource = license.html_url
  } else if (tool.name === "clangd") {
    const source = `https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-${record.version}/LICENSE.TXT`
    const response = await fetch(source)
    if (!response.ok) throw new Error(`Missing clangd license: ${response.status}`)
    await Bun.write(path.join(directory, "native", tool.name, "LICENSE.repository"), response)
    record.license = "Apache-2.0 WITH LLVM-exception"
    record.licenseSource = source
  } else throw new Error(`Missing license for ${tool.name}: ${response.status}`)
}
await Bun.write(path.join(directory, "native-manifest.json"), JSON.stringify(records, null, 2))

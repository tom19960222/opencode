#!/usr/bin/env bun

import path from "node:path"
import { chmod, cp, mkdir, readdir, rename, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import versions from "./air-gap-dotnet-lsp-versions.json"

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("The bundled .NET LSP resources target Linux x64")
}

const directory = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(import.meta.dir, "../assets"))
const downloadDirectory = path.resolve(process.env.OPENCODE_AIR_GAP_DOWNLOAD_DIR ?? path.join(directory, ".downloads"))
const dotnetDirectory = path.join(directory, "native/dotnet")
const roslynDirectory = path.join(directory, "native/roslyn")
const fsharpDirectory = path.join(directory, "native/fsharp")

await mkdir(downloadDirectory, { recursive: true })
await mkdir(path.join(directory, "bin"), { recursive: true })

async function prepareDotnet() {
  const executable = path.join(dotnetDirectory, "dotnet")
  const record = path.join(dotnetDirectory, "opencode-resource.json")
  const cachedArchive = path.join(downloadDirectory, versions.dotnet.archive)
  let archiveVerified = await fileExists(cachedArchive)
  if (!(await fileExists(executable))) {
    const archive = await sourceArchive(versions.dotnet)
    archiveVerified = true
    const staging = `${dotnetDirectory}.staging-${process.pid}`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await extract(["tar", "-xzf", archive, "-C", staging])
    await rm(dotnetDirectory, { recursive: true, force: true })
    await move(staging, dotnetDirectory)
    if (!process.env.OPENCODE_AIR_GAP_DOWNLOAD_DIR) await rm(archive, { force: true })
  } else if (!(await directoryExists(path.join(dotnetDirectory, `sdk/${versions.dotnet.version}`)))) {
    throw new Error(`Existing dotnet at ${executable} is not SDK ${versions.dotnet.version}`)
  } else {
    if (await fileExists(cachedArchive)) await verify(cachedArchive, versions.dotnet)
  }
  await chmod(executable, 0o755)
  await writeRecord(record, {
    ...versions.dotnet,
    artifact: "dotnet-sdk-directory",
    verification: archiveVerified ? "sha512" : "sdk-directory-only",
  })
  return versions.dotnet.version
}

async function prepareNugetTool(
  item: (typeof versions)["roslyn"] | (typeof versions)["fsharp"],
  destination: string,
  runtimePath: string,
) {
  const runtime = path.join(destination, "runtime")
  const executable = path.join(runtime, runtimePath)
  const record = path.join(destination, "opencode-resource.json")
  const archivePath = (await fileExists(executable)) ? undefined : await locateOrDownloadPackage(item, destination)
  if (!(await fileExists(executable))) {
    if (!archivePath) throw new Error(`${item.name}: package is missing`)
    const staging = `${runtime}.staging-${process.pid}`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await extract(["unzip", "-q", "-o", archivePath, "-d", staging])
    if (!(await fileExists(path.join(staging, runtimePath)))) {
      throw new Error(`${item.name}: package does not contain ${runtimePath}`)
    }
    await rm(runtime, { recursive: true, force: true })
    await move(staging, runtime)
  }
  if (item.name === "roslyn-language-server") {
    await chmod(path.join(runtime, "tools/net10.0/linux-x64/roslyn-language-server"), 0o755)
    await chmod(path.join(runtime, "tools/net10.0/linux-x64/Microsoft.CodeAnalysis.LanguageServer"), 0o755)
  }
  await writeRecord(record, {
    ...item,
    artifact: "nuget-package-runtime",
    runtime: `runtime/${runtimePath.slice(0, runtimePath.lastIndexOf("/"))}`,
    verification: archivePath ? "sha256" : "runtime-directory-only",
  })
  await rm(path.join(destination, ".store"), { recursive: true, force: true })
  await rm(path.join(destination, item.name), { recursive: true, force: true })
  if (archivePath && !process.env.OPENCODE_AIR_GAP_DOWNLOAD_DIR) await rm(archivePath, { force: true })
}

async function locateOrDownloadPackage(
  item: (typeof versions)["roslyn"] | (typeof versions)["fsharp"],
  destination: string,
) {
  const expected =
    item.package === "fsautocomplete"
      ? path.join(destination, ".store/fsautocomplete/0.84.0/fsautocomplete/0.84.0", item.archive)
      : path.join(
          destination,
          ".store/roslyn-language-server/5.12.0-1.26426.8/roslyn-language-server.linux-x64/5.12.0-1.26426.8",
          item.archive,
        )
  if (await fileExists(expected)) {
    await verify(expected, item)
    return expected
  }
  return sourceArchive(item)
}

async function sourceArchive(item: { archive: string; url: string; sha512?: string; sha256?: string }) {
  const archive = path.join(downloadDirectory, item.archive)
  if (!(await fileExists(archive))) {
    console.log(`Downloading ${item.url}`)
    const response = await fetch(item.url)
    if (!response.ok) throw new Error(`${item.url}: HTTP ${response.status}`)
    await Bun.write(archive, await response.arrayBuffer())
  }
  await verify(archive, item)
  return archive
}

async function verify(file: string, item: { name?: string; sha512?: string; sha256?: string }) {
  const bytes = await Bun.file(file).bytes()
  if (item.sha512) {
    const digest = createHash("sha512").update(bytes).digest("hex")
    if (digest !== item.sha512.toLowerCase()) {
      throw new Error(`SHA-512 mismatch for ${item.name ?? path.basename(file)}`)
    }
  }
  if (item.sha256) {
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (digest !== item.sha256) {
      throw new Error(`SHA-256 mismatch for ${item.name ?? path.basename(file)}`)
    }
  }
}

async function extract(command: string[]) {
  const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
  if ((await child.exited) !== 0) throw new Error(`Failed to extract ${command.at(0)}`)
}

async function move(from: string, to: string) {
  await rename(from, to)
}

async function writeWrappers() {
  await writeExecutable(path.join(directory, "bin/dotnet"), dotnetWrapper)
  await writeExecutable(path.join(directory, "bin/roslyn-language-server"), roslynWrapper)
  await writeExecutable(path.join(directory, "bin/fsautocomplete"), fsharpWrapper)
  await rm(path.join(roslynDirectory, "roslyn-language-server"), { force: true })
  await rm(path.join(fsharpDirectory, "fsautocomplete"), { force: true })
}

async function writeExecutable(file: string, contents: string) {
  await Bun.write(file, contents)
  await chmod(file, 0o755)
}

async function writeRecord(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify(value, null, 2) + "\n")
}

async function fileExists(file: string) {
  return await Bun.file(file).exists()
}

async function directoryExists(directory: string) {
  return await readdir(directory)
    .then(() => true)
    .catch(() => false)
}

async function checkRuntimeDependencies() {
  await bundleRuntimeDependencies()
  const hostLibraryDirectories = ["/lib/x86_64-linux-gnu", "/usr/lib/x86_64-linux-gnu", "/lib64", "/usr/lib64"]
  const hostNames = new Set(
    (await Promise.all(hostLibraryDirectories.map(async (directory) => readdir(directory).catch(() => [])))).flat(),
  )
  const bundledNames = new Set(await readdir(path.join(dotnetDirectory, "runtime-libs")).catch(() => []))
  const hasIcu = (names: Set<string>) =>
    ["libicuuc.so", "libicui18n.so", "libicudata.so"].every((name) =>
      [...names].some((candidate) => candidate === name || candidate.startsWith(`${name}.`)),
    )
  if (hasIcu(bundledNames)) return
  if (hasIcu(hostNames)) {
    console.warn(
      "ICU is available on the build host but is not bundled. Ubuntu 24 air-gapped hosts need libicu74 installed, or rerun with OPENCODE_AIR_GAP_DOTNET_RUNTIME_LIB_DIR pointing at the target lib directory.",
    )
    return
  }
  console.warn(
    "The build host has no ICU runtime. Ubuntu 24 air-gapped hosts must provide libicu74 (or set DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 with reduced globalization) for the bundled .NET runtime. Set OPENCODE_AIR_GAP_DOTNET_RUNTIME_LIB_DIR to a target Ubuntu lib directory to bundle ICU files.",
  )
}

async function bundleRuntimeDependencies() {
  const source = process.env.OPENCODE_AIR_GAP_DOTNET_RUNTIME_LIB_DIR
  const target = path.join(dotnetDirectory, "runtime-libs")
  if (source) {
    const names = await readdir(source).catch(() => {
      throw new Error(`Unable to read OPENCODE_AIR_GAP_DOTNET_RUNTIME_LIB_DIR: ${source}`)
    })
    const selected = names.filter((name) => /^(libicu|libssl|libcrypto|libz\.so)/.test(name))
    if (!selected.some((name) => /^libicuuc\.so(?:\.|$)/.test(name))) {
      throw new Error(`No ICU libraries found in ${source}`)
    }
    if (!selected.some((name) => /^libssl\.so(?:\.|$)/.test(name))) {
      throw new Error(`No OpenSSL libraries found in ${source}`)
    }
    if (!selected.some((name) => /^libz\.so(?:\.|$)/.test(name))) {
      throw new Error(`No zlib libraries found in ${source}`)
    }
    await mkdir(target, { recursive: true })
    await Promise.all(
      selected.map((name) =>
        cp(path.join(source, name), path.join(target, name), { force: true, verbatimSymlinks: true }),
      ),
    )
  }
  if (!(await directoryExists(target))) return
  const licenseSource = process.env.OPENCODE_AIR_GAP_DOTNET_RUNTIME_LICENSE_DIR
  if (licenseSource) {
    await cp(licenseSource, path.join(target, "licenses/ubuntu24"), { recursive: true, force: true })
  }
  await writeRuntimeDependencyMetadata(target)
}

async function writeRuntimeDependencyMetadata(target: string) {
  const packageManifest = Object.entries(versions.dotnet.runtimeLibraries.packages)
    .map(([name, version]) => `${name}\t${version}`)
    .join("\n")
  const packageManifestPath = path.join(target, "ubuntu24-packages.tsv")
  const suppliedManifest = process.env.OPENCODE_AIR_GAP_DOTNET_RUNTIME_PACKAGE_MANIFEST
  if (suppliedManifest) {
    const contents = await Bun.file(suppliedManifest)
      .text()
      .catch(() => {
        throw new Error(`Unable to read OPENCODE_AIR_GAP_DOTNET_RUNTIME_PACKAGE_MANIFEST: ${suppliedManifest}`)
      })
    const suppliedLines = new Set(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    )
    const expectedLines = packageManifest.split("\n")
    if (expectedLines.some((line) => !suppliedLines.has(line))) {
      throw new Error(`Ubuntu runtime package manifest does not match pinned versions in ${packageManifestPath}`)
    }
    await Bun.write(packageManifestPath, contents.endsWith("\n") ? contents : `${contents}\n`)
  } else {
    await Bun.write(packageManifestPath, `${packageManifest}\n`)
  }

  const names = (await readdir(target)).filter((name) => /^(libicu|libssl|libcrypto|libz\.so)/.test(name)).sort()
  const checksums = await Promise.all(
    names.map(async (name) => {
      const digest = createHash("sha256")
        .update(await Bun.file(path.join(target, name)).bytes())
        .digest("hex")
      return `${digest}  ${name}`
    }),
  )
  await Bun.write(path.join(target, "SHA256SUMS"), `${checksums.join("\n")}\n`)
}

const dotnetWrapper = `#!/usr/bin/env bash
set -euo pipefail
bin_dir=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd -P)\"
assets_dir=\"$(CDPATH= cd -- \"$bin_dir/..\" && pwd -P)\"
export DOTNET_ROOT=\"\${OPENCODE_AIR_GAP_DOTNET_ROOT:-$assets_dir/native/dotnet}\"
export DOTNET_ROOT_x64=\"$DOTNET_ROOT\"
export DOTNET_MULTILEVEL_LOOKUP=0
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1
export OTEL_SDK_DISABLED=true
export DOTNET_NOLOGO=1
if [[ -z \"\${DOTNET_CLI_HOME+x}\" ]]; then
  export DOTNET_CLI_HOME=\"\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/air-gap/dotnet-home\"
fi
if [[ -z \"\${NUGET_PACKAGES+x}\" ]]; then
  export NUGET_PACKAGES=\"\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/air-gap/nuget\"
fi
if [[ -z \"\${NUGET_HTTP_CACHE_PATH+x}\" ]]; then
  export NUGET_HTTP_CACHE_PATH=\"\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/air-gap/nuget-http-cache\"
fi
if [[ -z \"\${NUGET_PLUGINS_CACHE_PATH+x}\" ]]; then
  export NUGET_PLUGINS_CACHE_PATH=\"\${XDG_CACHE_HOME:-\${HOME:-/tmp}/.cache}/air-gap/nuget-plugins-cache\"
fi
export NUGET_CERT_REVOCATION_MODE=offline
mkdir -p \"$DOTNET_CLI_HOME\" \"$NUGET_PACKAGES\" \"$NUGET_HTTP_CACHE_PATH\" \"$NUGET_PLUGINS_CACHE_PATH\"
if [[ -d \"$assets_dir/native/dotnet/runtime-libs\" ]]; then
  export LD_LIBRARY_PATH=\"$assets_dir/native/dotnet/runtime-libs\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\"
fi
exec \"$DOTNET_ROOT/dotnet\" \"$@\"
`

const roslynWrapper = `#!/usr/bin/env bash
set -euo pipefail
bin_dir=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd -P)\"
assets_dir=\"$(CDPATH= cd -- \"$bin_dir/..\" && pwd -P)\"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1
export OTEL_SDK_DISABLED=true
exec \"$bin_dir/dotnet\" \"$assets_dir/native/roslyn/runtime/tools/net10.0/linux-x64/roslyn-language-server.dll\" \"$@\"
`

const fsharpWrapper = `#!/usr/bin/env bash
set -euo pipefail
bin_dir=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd -P)\"
assets_dir=\"$(CDPATH= cd -- \"$bin_dir/..\" && pwd -P)\"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=1
export OTEL_SDK_DISABLED=true
exec \"$bin_dir/dotnet\" \"$assets_dir/native/fsharp/runtime/tools/net10.0/any/fsautocomplete.dll\" \"$@\"
`

const dotnet = await prepareDotnet()
await prepareNugetTool(versions.roslyn, roslynDirectory, "tools/net10.0/linux-x64/roslyn-language-server.dll")
await prepareNugetTool(versions.fsharp, fsharpDirectory, "tools/net10.0/any/fsautocomplete.dll")
await writeWrappers()
await checkRuntimeDependencies()

console.log(`Prepared .NET ${dotnet} with Roslyn and FsAutoComplete for Linux x64`)
console.warn(
  "Razor LSP remains unavailable without a separately installed C# VS Code extension; see the razor entry in air-gap-dotnet-lsp-versions.json.",
)

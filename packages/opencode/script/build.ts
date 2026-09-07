#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const airGapped = process.argv.includes("--air-gapped")
const assetDir = path.resolve(process.env.OPENCODE_AIR_GAP_DIR ?? path.join(dir, "assets"))
if (airGapped) {
  process.env.MODELS_DEV_API_JSON ??= path.join(assetDir, "models.json")
  await import("./check-parsers.ts")
}
const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"
import pkg from "../package.json"

const singleFlag = process.argv.includes("--single")
if (airGapped && (!singleFlag || process.platform !== "linux")) {
  throw new Error("Air-gapped resources are target-specific: build on Linux with --single")
}
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const plugin = createSolidTransformPlugin()
const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")
if (airGapped && skipEmbedWebUi) throw new Error("Air-gapped packages must include the Web UI")

const createEmbeddedWebUIBundle = async () => {
  console.log(`Building Web UI to embed in the binary`)
  const appDir = path.join(import.meta.dirname, "../../app")
  const dist = path.join(appDir, "dist")
  if (!process.argv.includes("--reuse-web-ui")) {
    await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  }
  if (!(await Bun.file(path.join(dist, "index.html")).exists())) throw new Error("Build the Web UI before embedding it")
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    `// Import all files as file_$i with type: "file"`,
    ...imports,
    `// Export with original mappings`,
    `export default {`,
    ...entries,
    `}`,
  ].join("\n")
}

const embeddedFileMap = skipEmbedWebUi ? null : await createEmbeddedWebUIBundle()
const treeSitterWorker = await Bun.file(fileURLToPath(import.meta.resolve("@opentui/core/parser.worker"))).text()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  {
    os: "linux",
    arch: "arm64",
  },
  {
    os: "linux",
    arch: "x64",
  },
  {
    os: "linux",
    arch: "x64",
    avx2: false,
  },
  {
    os: "linux",
    arch: "arm64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
  },
  {
    os: "linux",
    arch: "x64",
    abi: "musl",
    avx2: false,
  },
  {
    os: "darwin",
    arch: "arm64",
  },
  {
    os: "darwin",
    arch: "x64",
  },
  {
    os: "darwin",
    arch: "x64",
    avx2: false,
  },
  {
    os: "win32",
    arch: "arm64",
  },
  {
    os: "win32",
    arch: "x64",
  },
  {
    os: "win32",
    arch: "x64",
    avx2: false,
  },
]

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) {
        return false
      }

      // Ubuntu uses glibc; do not also produce an incompatible musl package.
      if (airGapped && item.abi !== undefined) return false

      // The offline Linux package targets baseline CPUs so one artifact covers
      // Ubuntu machines without AVX2 as well as newer desktops.
      if (airGapped && baselineFlag && item.arch === "x64" && item.avx2 !== false) return false

      // When building for the current platform, prefer a single native binary by default.
      // Baseline binaries require additional Bun artifacts and can be flaky to download.
      if (item.avx2 === false) {
        return baselineFlag
      }

      // also skip abi-specific builds for the same reason
      if (item.abi !== undefined) {
        return false
      }

      return true
    })
  : allTargets

if (!airGapped) await $`rm -rf dist`

const binaries: Record<string, string> = {}
if (!skipInstall) {
  await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`
  await $`bun install --os="*" --cpu="*" @parcel/watcher@${pkg.dependencies["@parcel/watcher"]}`
  await $`bun install --os="*" --cpu="*" @ff-labs/fff-bun@${pkg.dependencies["@ff-labs/fff-bun"]}`
}
for (const item of targets) {
  const name = [
    pkg.name,
    // changing to win32 flags npm for some reason
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi === undefined ? undefined : item.abi,
  ]
    .filter(Boolean)
    .join("-")
  console.log(`building ${name}`)
  if (airGapped) await $`rm -rf dist/${name}`
  await $`mkdir -p dist/${name}/bin`

  const workerPath = "./src/cli/tui/worker.ts"
  const treeSitterWorkerPath = "opentui-tree-sitter-worker.js"
  const bunfsRoot = item.os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace(pkg.name, "bun") as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
      windows: {},
    },
    files: {
      [treeSitterWorkerPath]: treeSitterWorker,
      ...(embeddedFileMap ? { "opencode-web-ui.gen.ts": embeddedFileMap } : {}),
    },
    entrypoints: [
      "./src/index.ts",
      workerPath,
      treeSitterWorkerPath,
      ...(embeddedFileMap ? ["opencode-web-ui.gen.ts"] : []),
    ],
    define: {
      FFF_LIBC: JSON.stringify(item.abi === "musl" ? "musl" : "gnu"),
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_MODELS_DEV: generated.modelsData,
      OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + treeSitterWorkerPath,
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  // Smoke test: only run if binary is for current platform
  if (item.os === process.platform && item.arch === process.arch && !item.abi) {
    const binaryPath = `dist/${name}/bin/opencode`
    console.log(`Running smoke test: ${binaryPath} --version`)
    try {
      const versionOutput = await $`${binaryPath} --version`.text()
      console.log(`Smoke test passed: ${versionOutput.trim()}`)
    } catch (e) {
      console.error(`Smoke test failed for ${name}:`, e)
      process.exit(1)
    }
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
        ...(item.abi ? { libc: [item.abi] } : {}),
      },
      null,
      2,
    ),
  )
  if (airGapped) {
    await $`cp -a ${assetDir} dist/${name}/assets`
    await Bun.write(
      `dist/${name}/package.json`,
      JSON.stringify(
        {
          name: `${name}-air-gapped`,
          version: Script.version,
          description: "Self-contained offline OpenCode for Ubuntu 24 (glibc)",
          bin: { opencode: "bin/opencode" },
          engines: { node: ">=22" },
          os: [item.os],
          cpu: [item.arch],
          files: ["bin", "assets"],
          license: "MIT",
        },
        null,
        2,
      ) + "\n",
    )
    await Bun.write(`dist/${name}/LICENSE`, Bun.file(path.join(dir, "../../LICENSE")))
    await Bun.write(`dist/${name}/DOTNET-LICENSES.txt`, Bun.file(path.join(dir, "script/licenses/dotnet-LICENSES.txt")))
    await Bun.write(`dist/${name}/README.md`, Bun.file(path.join(dir, "../../docs/air-gap.md")))
    for (const file of [
      "air-gap-network-inventory.md",
      "air-gap-native-prerequisites.md",
      "air-gap-network-sites.txt",
    ]) {
      await Bun.write(`dist/${name}/${file}`, Bun.file(path.join(dir, "../../docs", file)))
    }
    await $`find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS`.cwd(`dist/${name}`)
    // Keep nested asset node_modules opaque to npm's dependency-tree scanner.
    // The Node launcher unpacks this local archive into a writable cache once.
    const npm = `dist/${name}-npm-${Script.version}`
    await $`rm -rf ${npm}`
    await $`mkdir -p ${npm}/bin`
    await $`tar -I "gzip -1" -cf ../${name}-npm-${Script.version}/assets.tar.gz assets`.cwd(`dist/${name}`)
    await $`cp dist/${name}/bin/opencode ${npm}/bin/opencode`
    await Bun.write(`${npm}/bin/opencode.cjs`, Bun.file(path.join(dir, "script/air-gap-launcher.cjs")))
    await $`chmod +x ${npm}/bin/opencode.cjs`
    for (const file of [
      "README.md",
      "LICENSE",
      "DOTNET-LICENSES.txt",
      "air-gap-network-inventory.md",
      "air-gap-native-prerequisites.md",
      "air-gap-network-sites.txt",
    ]) {
      await Bun.write(`${npm}/${file}`, Bun.file(`dist/${name}/${file}`))
    }
    await Bun.write(
      `${npm}/package.json`,
      JSON.stringify(
        {
          ...(await Bun.file(`dist/${name}/package.json`).json()),
          bin: { opencode: "bin/opencode.cjs" },
          files: ["bin", "assets.tar.gz", "*.md", "*.txt", "LICENSE", "SHA256SUMS"],
          opencodeAssetsSha256: (await $`sha256sum assets.tar.gz`.cwd(npm).text()).split(" ")[0],
        },
        null,
        2,
      ) + "\n",
    )
    await $`find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS`.cwd(npm)
    await $`tar -I "gzip -1" -cf ../${name}-air-gapped-${Script.version}.tgz --transform=s,^./,package/, .`.cwd(npm)
    console.log(`Created npm package: dist/${name}-air-gapped-${Script.version}.tgz`)
    await $`tar -I "gzip -1" -cf ../${name}-air-gapped-${Script.version}.tar.gz --transform=s,^./,package/, .`.cwd(
      `dist/${name}`,
    )
  }
  binaries[name] = Script.version
}

if (Script.release) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }
  await $`gh release upload v${Script.version} ./dist/*.zip ./dist/*.tar.gz --clobber --repo ${process.env.GH_REPO}`
}

export { binaries }

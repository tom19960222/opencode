export * as AirGap from "./air-gap"

import path from "path"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Flag } from "./flag/flag"

export function directory() {
  return process.env.OPENCODE_AIR_GAP_DIR ?? path.resolve(path.dirname(process.execPath), "../assets")
}

export function environment(input?: NodeJS.ProcessEnv) {
  if (!Flag.OPENCODE_AIR_GAPPED) return input
  return {
    ...(input ?? process.env),
    OPENCODE_AIR_GAPPED: "1",
    OPENCODE_AIR_GAP_DIR: directory(),
    PATH: [path.join(directory(), "bin"), input?.PATH ?? process.env.PATH].filter(Boolean).join(path.delimiter),
    GOPROXY: "off",
    GOSUMDB: "off",
    GONOPROXY: "none",
    GOPRIVATE: "",
    GOTOOLCHAIN: "local",
    GOTELEMETRY: "off",
    CARGO_NET_OFFLINE: "true",
    RUSTUP_AUTO_INSTALL: "0",
    DENO_NO_UPDATE_CHECK: "1",
    CHECKPOINT_DISABLE: "1",
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_update_notifier: "false",
    PIP_NO_INDEX: "1",
  }
}

// Resource names contain only a URL digest, so untrusted URLs cannot escape the asset directory.
export function resource(url: string) {
  return path.join(directory(), "resources", createHash("sha256").update(url).digest("hex"))
}

export async function read(url: string) {
  return readFile(resource(url)).catch((cause) => {
    throw new Error(`Air-gapped resource is missing: ${url}. Prepackage it at ${resource(url)}.`, { cause })
  })
}

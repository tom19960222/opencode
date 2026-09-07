import whichPkg from "which"
import { AirGap } from "../air-gap"
import { Flag } from "../flag/flag"
import path from "path"
import { Global } from "../global"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = [Flag.OPENCODE_AIR_GAPPED ? path.join(AirGap.directory(), "bin") : "", base, Global.Path.bin]
    .filter(Boolean)
    .join(path.delimiter)
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: full,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return typeof result === "string" ? result : null
}

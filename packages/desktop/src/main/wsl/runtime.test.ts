import { afterEach, expect, test } from "bun:test"
import { installWslDistro, installWslOpencode, installWslRuntimeElevated, listOnlineWslDistros } from "./runtime"

const previousMode = process.env.OPENCODE_AIR_GAPPED

afterEach(() => {
  if (previousMode === undefined) delete process.env.OPENCODE_AIR_GAPPED
  else process.env.OPENCODE_AIR_GAPPED = previousMode
})

test("air-gapped WSL listing does not query online distributions", async () => {
  process.env.OPENCODE_AIR_GAPPED = "on"
  expect(await listOnlineWslDistros()).toEqual([])
})

test("air-gapped WSL installation paths fail before invoking installers", async () => {
  process.env.OPENCODE_AIR_GAPPED = "1"
  await expect(installWslRuntimeElevated()).rejects.toThrow()
  await expect(installWslDistro("Ubuntu-24.04")).rejects.toThrow()
  await expect(installWslOpencode("1.18.29", "Ubuntu-24.04")).rejects.toThrow()
})

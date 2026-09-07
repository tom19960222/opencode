import { afterEach, describe, expect, test } from "bun:test"
import { airGapped, allowsAirGapURL } from "./air-gap"

const previousMode = process.env.OPENCODE_AIR_GAPPED
const previousOrigins = process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS

afterEach(() => {
  if (previousMode === undefined) delete process.env.OPENCODE_AIR_GAPPED
  else process.env.OPENCODE_AIR_GAPPED = previousMode
  if (previousOrigins === undefined) delete process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS
  else process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS = previousOrigins
})

describe("desktop air-gap policy", () => {
  test("recognizes enabled environment values", () => {
    for (const value of ["1", "true", "on", " TRUE "]) {
      process.env.OPENCODE_AIR_GAPPED = value
      expect(airGapped()).toBe(true)
    }
    process.env.OPENCODE_AIR_GAPPED = "0"
    expect(airGapped()).toBe(false)
  })

  test("allows local and explicitly configured endpoints only", () => {
    process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS = "https://models.internal:8443"
    expect(allowsAirGapURL("oc://renderer/index.html")).toBe(true)
    expect(allowsAirGapURL("http://127.0.0.1:4096/health")).toBe(true)
    expect(allowsAirGapURL("http://10.0.0.2:8080/health")).toBe(true)
    expect(allowsAirGapURL("wss://models.internal:8443/socket")).toBe(true)
    expect(allowsAirGapURL("https://example.com/model")).toBe(false)
    expect(allowsAirGapURL("ftp://example.com/model")).toBe(false)
  })
})

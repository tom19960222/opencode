import { afterEach, expect, test } from "bun:test"
import { localFetch, requireLocal } from "../src/air-gap-network"
import { Flag } from "../src/flag/flag"

const original = process.env.OPENCODE_AIR_GAPPED
const origins = process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS
afterEach(() => {
  if (original === undefined) delete process.env.OPENCODE_AIR_GAPPED
  else process.env.OPENCODE_AIR_GAPPED = original
  if (origins === undefined) delete process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS
  else process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS = origins
})

test("air-gap switch overrides background fetch and only permits local HTTP endpoints", () => {
  process.env.OPENCODE_AIR_GAPPED = "on"
  delete process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS
  expect(Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe(true)
  expect(Flag.OPENCODE_DISABLE_MODELS_FETCH).toBe(true)
  expect(() => localFetch.preconnect("https://example.com")).toThrow("Air-gapped mode")
  for (const url of [
    "http://localhost:11434",
    "http://127.0.0.1",
    "http://[::1]",
    "http://10.2.3.4",
    "https://192.168.1.2",
    "http://172.16.0.1",
  ]) {
    expect(() => requireLocal(url)).not.toThrow()
  }
  for (const url of [
    "https://example.com",
    "http://localhost.example.com",
    "http://172.32.0.1",
    "http://169.254.169.254",
    "file:///etc/passwd",
  ]) {
    expect(() => requireLocal(url)).toThrow("Air-gapped mode")
  }
  process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS = "http://model.internal:8000"
  expect(() => requireLocal("http://model.internal:8000/v1")).not.toThrow()
  expect(() => requireLocal("http://model.internal:8001/v1")).toThrow()
  process.env.OPENCODE_AIR_GAPPED = "off"
  expect(() => requireLocal("https://example.com")).not.toThrow()
})

test("local model HTTP works but redirects cannot escape the air gap", async () => {
  process.env.OPENCODE_AIR_GAPPED = "1"
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/redirect") return Response.redirect("https://example.com")
      return new Response("local model")
    },
  })
  try {
    const url = server.url
    expect(await (await localFetch(url)).text()).toBe("local model")
    await expect(localFetch(new URL("/redirect", url))).rejects.toThrow()
    await expect(localFetch("https://example.com")).rejects.toThrow("Air-gapped mode")
  } finally {
    await server.stop(true)
  }
})

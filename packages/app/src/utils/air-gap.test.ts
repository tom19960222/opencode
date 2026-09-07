import { afterEach, describe, expect, test } from "bun:test"
import { airGapFetch, isLocalURL, requireLocalURL } from "./air-gap"
import { terminalWebSocketURL } from "./terminal-websocket-url"

const meta = () => {
  const value = document.createElement("meta")
  value.name = "opencode-air-gapped"
  value.content = "on"
  document.head.append(value)
  return value
}

afterEach(() => {
  document.querySelectorAll('meta[name^="opencode-air-gap"]').forEach((node) => node.remove())
})

describe("air-gapped browser transport", () => {
  test("normalizes address forms and excludes lookalike public hosts", () => {
    for (const url of [
      "http://127.1:4096",
      "http://0x7f000001",
      "https://10.2.3.4",
      "http://172.16.2.3",
      "http://192.168.2.3",
      "ws://[::1]",
      "wss://[fd00::1]",
    ])
      expect(isLocalURL(new URL(url))).toBe(true)
    for (const url of [
      "https://localhost.example",
      "https://10.example.com",
      "http://172.15.1.1",
      "http://192.169.0.1",
      "http://[::ffff:8.8.8.8]",
      "https://user:pass@example.com",
      "ftp://127.0.0.1",
    ])
      expect(isLocalURL(new URL(url))).toBe(false)
  })

  test("rejects public HTTP and WebSocket destinations before delegating, but preserves online behavior", async () => {
    const calls: { input: Parameters<typeof fetch>[0]; init?: RequestInit }[] = []
    const transport = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ input, init })
        return new Response("local response")
      },
      { preconnect: globalThis.fetch.preconnect },
    )
    const request = airGapFetch(transport)
    const mode = meta()
    await expect(request("https://example.com/api/health")).rejects.toMatchObject({ name: "SecurityError" })
    expect(() =>
      terminalWebSocketURL({ url: "https://example.com", id: "pty1", directory: "/tmp", cursor: 0 }),
    ).toThrow()
    expect(calls).toHaveLength(0)
    await request(new Request("http://127.0.0.1:4096/api/health", { redirect: "follow" }))
    expect(calls[0]?.init?.redirect).toBe("error")
    expect(
      terminalWebSocketURL({ url: "http://127.0.0.1:4096", id: "pty1", directory: "/tmp", cursor: 0 }).protocol,
    ).toBe("ws:")
    mode.remove()
    await request("https://example.com/api/health", { redirect: "follow" })
    expect(calls[1]?.init?.redirect).toBe("follow")
  })

  test("honors exact configured private DNS origins without allowing suffix matches", () => {
    meta()
    const allow = document.createElement("meta")
    allow.name = "opencode-air-gap-allow-origins"
    allow.content = "https://intranet.example:4096"
    document.head.append(allow)
    expect(() => requireLocalURL("https://intranet.example:4096/api/health")).not.toThrow()
    expect(() => requireLocalURL("wss://intranet.example:4096/api/events")).not.toThrow()
    expect(() => requireLocalURL("https://intranet.example:4097/api/health")).toThrow()
    expect(() => requireLocalURL("https://intranet.example.evil:4096/api/health")).toThrow()
  })
})

import { isIP } from "node:net"
import { Flag } from "./flag/flag"

// Only literal private addresses and explicit origins are allowed: arbitrary
// hostnames could resolve outside the isolated network.
export function requireLocal(input: string | URL | Request) {
  if (!Flag.OPENCODE_AIR_GAPPED) return
  const url = new URL(input instanceof Request ? input.url : input)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const parts = host.split(".").map(Number)
  const local =
    host === "localhost" ||
    host === "::1" ||
    (isIP(host) === 4 &&
      (parts[0] === 127 ||
        parts[0] === 10 ||
        (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
        (parts[0] === 192 && parts[1] === 168))) ||
    (isIP(host) === 6 && /^(fc|fd)/i.test(host))
  const allowed = (process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS ?? "").split(",").map((x) => x.trim())
  if ((url.protocol === "http:" || url.protocol === "https:") && (local || allowed.includes(url.origin))) return
  throw new Error(`Air-gapped mode blocked internet access to ${url.origin}. Configure a local service endpoint.`)
}

export const localFetch: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    requireLocal(input)
    return fetch(input, Flag.OPENCODE_AIR_GAPPED ? { ...init, redirect: "error" } : init)
  },
  {
    preconnect: (...args: Parameters<typeof fetch.preconnect>) => {
      requireLocal(args[0])
      return fetch.preconnect?.(...args)
    },
  },
)

import { isIP } from "node:net"

const NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"])
const LOCAL_PROTOCOLS = new Set(["about:", "blob:", "data:", "devtools:", "file:", "oc:"])

export function airGapped() {
  const value = process.env.OPENCODE_AIR_GAPPED?.trim().toLowerCase()
  return value === "1" || value === "true" || value === "on"
}

export function allowsAirGapURL(value: string | URL) {
  const url = new URL(value)
  if (LOCAL_PROTOCOLS.has(url.protocol)) return true
  if (!NETWORK_PROTOCOLS.has(url.protocol)) return false

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
  if (local) return true

  const allowed = (process.env.OPENCODE_AIR_GAP_ALLOW_ORIGINS ?? "").split(",").map((item) => item.trim())
  if (allowed.includes(url.origin)) return true
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    const httpOrigin = `${url.protocol === "ws:" ? "http:" : "https:"}//${url.host}`
    if (allowed.includes(httpOrigin)) return true
  }
  return false
}

export function airGapped() {
  if (typeof document === "undefined") return false
  return ["on", "true", "1"].includes(
    document.querySelector('meta[name="opencode-air-gapped"]')?.getAttribute("content") ?? "",
  )
}

// Browsers cannot safely resolve arbitrary DNS names before opening a connection.
// Same-origin and explicitly configured origins support private DNS deployments.
export function isLocalURL(url: URL, origin = "", allowed: string[] = []) {
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false
  const normalized = new URL(url)
  normalized.protocol = url.protocol === "ws:" ? "http:" : url.protocol === "wss:" ? "https:" : url.protocol
  if (normalized.origin === origin || allowed.includes(normalized.origin)) return true
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host === "::1") return true
  if (host.includes(":") && /^(fc|fd)/i.test(host)) return true
  const parts = host.split(".").map(Number)
  if (parts.length !== 4 || !parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}

export function requireLocalURL(input: string | URL | Request) {
  if (!airGapped()) return
  const url = new URL(input instanceof Request ? input.url : input, document.baseURI)
  const allowed = (document.querySelector('meta[name="opencode-air-gap-allow-origins"]')?.getAttribute("content") ?? "")
    .split(",")
    .map((origin) => origin.trim())
  if (isLocalURL(url, location.origin, allowed)) return
  throw new DOMException("", "SecurityError")
}

export function airGapFetch(fetcher: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requireLocalURL(input)
      return fetcher(input, airGapped() ? { ...init, redirect: "error" } : init)
    },
    {
      preconnect: (...args: Parameters<typeof fetch.preconnect>) => {
        requireLocalURL(args[0])
        return fetcher.preconnect?.(...args)
      },
    },
  )
}

export function localImageSource(source?: string) {
  if (!source || !airGapped() || /^(data:|blob:)/.test(source)) return source
  if (!URL.canParse(source, document.baseURI)) return
  const url = new URL(source, document.baseURI)
  return isLocalURL(url, location.origin) ? source : undefined
}

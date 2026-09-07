// Connected preparation: snapshot release notes and keep their media local in offline builds.
import path from "node:path"
import { createHash } from "node:crypto"

const source = "https://opencode.ai/changelog.json"
const response = await fetch(source)
if (!response.ok) throw new Error(`Cannot snapshot release notes: ${response.status}`)
const changelog: unknown = await response.json()
const assets: Record<string, string> = {}

async function prepare(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) await prepare(item)
    return
  }
  const record = value as Record<string, unknown>
  if (record.media && typeof record.media === "object") {
    const media = record.media as Record<string, unknown>
    const key = typeof media.src === "string" ? "src" : "url"
    if (typeof media[key] === "string") {
      const url = new URL(media[key], source)
      if (["http:", "https:"].includes(url.protocol)) {
        const name = createHash("sha256").update(url.href).digest("hex") + (path.extname(url.pathname) || ".bin")
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Cannot snapshot release media: ${url.href}`)
        await Bun.write(path.join(import.meta.dir, "../public/airgap/media", name), response)
        assets[url.href] = `/airgap/media/${name}`
        media[key] = assets[url.href]
      }
    }
  }
  for (const item of Object.values(record)) await prepare(item)
}
await prepare(changelog)
await Bun.write(
  path.join(import.meta.dir, "../src/assets/air-gap-changelog.json"),
  JSON.stringify(changelog, null, 2) + "\n",
)
await Bun.write(
  path.join(import.meta.dir, "../src/assets/air-gap-changelog-sources.json"),
  JSON.stringify({ source, assets }, null, 2) + "\n",
)

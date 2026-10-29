import { createHash } from "node:crypto"
import { lstat, readdir, readFile } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"
import { zipSync } from "fflate"

const blocked = /(^|\/)(\.[^/]+|node_modules|vendor|coverage|__MACOSX)(\/|$)|\.(pem|key|p12|pfx|sqlite|sqlite3|db|map)$/i
const credential = /-----BEGIN [A-Z ]*PRIVATE KEY|(?:ghp_|github_pat_|sk-(?:live|test|proj)-|xox[bpas]-)[A-Za-z0-9_-]{8,}/
const maxBytes = 50 * 1024 * 1024

export async function prepareUpload(path: string, token?: string) {
  const files: Record<string, Uint8Array> = Object.create(null)
  const manifest: { path: string; bytes: number }[] = []
  const walk = async (source: string, name: string): Promise<void> => {
    if (blocked.test(name)) throw new Error(`Refusing ${name}: publish a clean build folder without hidden files, secrets, dependencies, or source maps.`)
    const stat = await lstat(source)
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${name}`)
    if (stat.isDirectory()) {
      const entries = await readdir(source)
      for (const entry of entries.sort()) await walk(join(source, entry), name ? `${name}/${entry}` : entry)
      return
    }
    if (!stat.isFile()) throw new Error(`Refusing special file: ${name}`)
    if (manifest.length >= 1000 || manifest.reduce((sum, file) => sum + file.bytes, 0) + stat.size > maxBytes)
      throw new Error("Upload limit: 1,000 files and 50 MiB of uncompressed content.")
    const data = await readFile(source)
    const text = data.toString("utf8")
    if (credential.test(text) || (token && text.includes(token))) throw new Error(`Possible credential in ${name}; remove it before publishing.`)
    files[name] = data
    manifest.push({ path: name, bytes: data.length })
  }
  const source = resolve(path)
  const stat = await lstat(source)
  if (stat.isSymbolicLink()) throw new Error("Select a real folder or HTML file, not a symlink.")
  if (!stat.isDirectory() && !/\.html?$/i.test(extname(source))) throw new Error("Select a static build folder or an HTML file. Extract ZIP archives first.")
  if (!stat.isDirectory() && blocked.test(basename(source))) throw new Error("Select a public HTML file.")
  await walk(source, stat.isDirectory() ? "" : "index.html")
  if (!files["index.html"]) throw new Error("The selected folder must contain index.html at its root. Build your site first and select dist/, out/, or build/.")
  if (manifest.reduce((sum, file) => sum + file.bytes, 0) > maxBytes) throw new Error("Upload exceeds 50 MiB.")
  // Fix ZIP timestamps so the same file bytes always produce the same preview digest.
  const data = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { mtime: new Date(1980, 0, 1) }]])), { level: 6 })
  if (data.length > maxBytes) throw new Error("Compressed upload exceeds 50 MiB.")
  return { data, digest: createHash("sha256").update(data).digest("hex"), files: manifest, bytes: manifest.reduce((sum, file) => sum + file.bytes, 0) }
}

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unzipSync, strFromU8 } from "fflate"
import { prepareUpload } from "../src/upload"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "opencode-pagey-test-"))
  roots.push(root)
  await writeFile(join(root, "index.html"), "<!doctype html><h1>Pagey</h1>")
  return root
}

test("ZIP contains real nested assets; digest is stable and changes with content", async () => {
  const root = await fixture()
  await mkdir(join(root, "assets"))
  await writeFile(join(root, "assets/style.css"), "body{color:green}")
  const first = await prepareUpload(root)
  expect(strFromU8(unzipSync(first.data)["assets/style.css"])).toBe("body{color:green}")
  expect((await prepareUpload(root)).digest).toBe(first.digest)
  await writeFile(join(root, "index.html"), "<h1>Updated</h1>")
  expect((await prepareUpload(root)).digest).not.toBe(first.digest)
})

test.each([".env", ".git/config", "assets/private.key", "assets/app.js.map", "node_modules/package.json"])("rejects %s", async (name) => {
  const root = await fixture()
  const file = join(root, name)
  await mkdir(join(file, ".."), { recursive: true })
  await writeFile(file, "not public")
  await expect(prepareUpload(root)).rejects.toThrow("Refusing")
})

test("rejects symlinks, missing root index, and credential content", async () => {
  const root = await fixture()
  await symlink(join(root, "index.html"), join(root, "alias.html"))
  await expect(prepareUpload(root)).rejects.toThrow("symlink")
  await rm(join(root, "alias.html"))
  await writeFile(join(root, "index.html"), "the-test-pagey-token")
  await expect(prepareUpload(root, "the-test-pagey-token")).rejects.toThrow("credential")
  await rm(join(root, "index.html"))
  await expect(prepareUpload(root)).rejects.toThrow("index.html")
})

test("single HTML files become root index.html", async () => {
  const root = await fixture()
  await writeFile(join(root, "demo.html"), "<h1>Demo</h1>")
  const upload = await prepareUpload(join(root, "demo.html"))
  expect(Object.keys(unzipSync(upload.data))).toEqual(["index.html"])
  expect(strFromU8(unzipSync(upload.data)["index.html"])).toBe("<h1>Demo</h1>")
})

test("rejects oversized files before reading", async () => {
  const root = await fixture()
  const { truncate } = await import("node:fs/promises")
  await truncate(join(root, "index.html"), 51 * 1024 * 1024)
  await expect(prepareUpload(root)).rejects.toThrow("50 MiB")
})

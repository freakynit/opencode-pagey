import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index"
import { siteSchema } from "../src/api"

test("registration and disposal use the real v2 tool definitions", async () => {
  const tools: { name: string; input: unknown; description: string }[] = []
  const context = { location: { directory: "/tmp" }, tool: { transform: async (callback: (editor: { add: (tool: typeof tools[number]) => void }) => void) => { callback({ add: (tool) => tools.push(tool) }); return { dispose: async () => { tools.splice(0) } } } } }
  const dispose = await plugin.setup(context as unknown as Plugin.Context)
  expect(tools.map((tool) => tool.name)).toEqual(["pagey_preview", "pagey_publish", "pagey_list", "pagey_get", "pagey_settings"])
  await dispose()
  expect(tools).toHaveLength(0)
})

test("API site projection strips private fields and constructs a valid URL", () => {
  const safe = siteSchema.parse({ id: "c4816145-a4b2-4aa2-8f31-eb38762df181", subdomain: "my-demo", status: "active", passwordHash: "private", folderUuid: "storage-path", userId: "private" })
  expect(safe.url).toBe("https://my-demo.pagey.site")
  expect(safe).not.toHaveProperty("passwordHash")
  expect(safe).not.toHaveProperty("folderUuid")
  expect(() => siteSchema.parse({ ...safe, subdomain: "evil.example/path" })).toThrow()
})

test("publishing rejects stale previews and denied permissions before any upload", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { prepareUpload } = await import("../src/upload")
  const root = await mkdtemp(join(tmpdir(), "pagey-permission-"))
  const originalToken = process.env.PAGEY_API_TOKEN
  process.env.PAGEY_API_TOKEN = "test-token-no-network"
  type Editor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]
  const tools: Parameters<Editor["add"]>[0][] = []
  const approvals: string[] = []
  const context = { location: { directory: root }, permission: { assert: async (input: { action: string }) => { approvals.push(input.action); throw new Error("User denied upload") } }, tool: { transform: async (callback: (editor: Pick<Editor, "add">) => void) => { callback({ add: (tool) => tools.push(tool) }); return { dispose: async () => {} } } } }
  try {
    await writeFile(join(root, "index.html"), "<h1>Preview</h1>")
    const digest = (await prepareUpload(root)).digest
    await plugin.setup(context as unknown as Plugin.Context)
    const publish = tools.find((tool) => tool.name === "pagey_publish")!
    const call = { signal: new AbortController().signal, sessionID: "test", agent: "build", messageID: "test", id: "test", progress: async () => {} } as unknown as Parameters<typeof publish.execute>[1]
    await writeFile(join(root, "index.html"), "<h1>Changed</h1>")
    await expect(publish.execute({ path: root, digest }, call)).rejects.toThrow("Files changed")
    expect(approvals).toHaveLength(0)
    await expect(publish.execute({ path: root, digest: (await prepareUpload(root)).digest }, call)).rejects.toThrow("User denied")
    expect(approvals).toEqual(["pagey.publish"])
    await expect(publish.execute({ path: root, digest, siteId: "bad-id" }, call)).rejects.toThrow()
  } finally {
    if (originalToken === undefined) delete process.env.PAGEY_API_TOKEN
    if (originalToken !== undefined) process.env.PAGEY_API_TOKEN = originalToken
    await rm(root, { recursive: true, force: true })
  }
})

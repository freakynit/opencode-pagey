import type { Plugin } from "@opencode/plugin"
import { resolve } from "node:path"
import { z } from "zod"
import { api, siteSchema } from "./api"
import { prepareUpload } from "./upload"

const path = z.string().min(1).describe("Public static build folder or HTML file, relative to the OpenCode location. Build the site first.")
const siteId = z.string().uuid().describe("Pagey site ID from publish or list")
const settings = z.object({
  title: z.string().max(255).nullable().optional(),
  password: z.string().min(6).nullable().optional().describe("null removes password protection; never include private credentials"),
  expiresAt: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) > Date.now(), "Expiry must be in the future").nullable().optional(),
})

export default {
  id: "pagey",
  async setup(ctx) {
    const token = () => process.env.PAGEY_API_TOKEN?.trim() ?? ""
    const definitions = [
      {
        name: "pagey_preview",
        description: "Preview the exact public files before publishing to Pagey. Returns a digest required by pagey_publish. Review files and ask the user before uploading. No network requests. Does not run builds.",
        input: z.object({ path }),
        execute: async (input: { path: string }) => {
          const prepared = await prepareUpload(resolve(ctx.location.directory, input.path), token())
          return { path: input.path, digest: prepared.digest, bytes: prepared.bytes, files: prepared.files }
        },
      },
      {
        name: "pagey_publish",
        description: "Publish a previewed static build to free Pagey hosting. Needs pagey_preview digest. Omit siteId for a NEW site; pass siteId to REPLACE ALL content at its existing URL. Explain replacement to the user. Returns site ID and HTTPS URL. List sites before retrying failures.",
        input: settings.extend({ path, digest: z.string().regex(/^[a-f0-9]{64}$/), siteId: siteId.optional(), subdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).optional() }).refine((input) => !input.siteId || [input.title, input.password, input.expiresAt, input.subdomain].every((value) => value === undefined), "Content replacement accepts only path, digest, and siteId. Use pagey_settings for metadata."),
        execute: async (input: { path: string; digest: string; siteId?: string; subdomain?: string; title?: string | null; password?: string | null; expiresAt?: string | null }, signal: AbortSignal, approve: (action: string, resources: string[], metadata?: Record<string, unknown>) => Promise<void>) => {
          const request = api(token(), signal)
          const prepared = await prepareUpload(resolve(ctx.location.directory, input.path), token())
          if (prepared.digest !== input.digest) throw new Error("Files changed since preview. Run pagey_preview and review the new files before publishing.")
          await approve(input.siteId ? "pagey.replace" : "pagey.publish", [input.siteId ?? "new-site"], { path: input.path, digest: prepared.digest, bytes: prepared.bytes, files: prepared.files, replacesAllContent: Boolean(input.siteId) })
          const form = new FormData()
          form.set("file", new Blob([new Uint8Array(prepared.data)], { type: "application/zip" }), "site.zip")
          if (!input.siteId) {
            if (input.subdomain) form.set("customSubdomain", input.subdomain)
            for (const key of ["title", "password", "expiresAt"] as const) if (input[key] != null) form.set(key, input[key])
          }
          return z.object({ site: siteSchema }).parse(await request(input.siteId ? "PUT" : "POST", input.siteId ? `/sites/${input.siteId}/content` : "/sites", form)).site
        },
      },
      {
        name: "pagey_list",
        description: "List your Pagey sites with IDs and HTTPS URLs. Use to find an existing site before updating or retrying publishing.",
        input: z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(20), search: z.string().optional(), status: z.enum(["active", "deleted", "expired"]).optional() }),
        execute: async (input: { page: number; pageSize: number; search?: string; status?: string }, signal: AbortSignal) => {
          const query = new URLSearchParams(Object.entries(input).filter((entry) => entry[1] !== undefined).map(([key, value]) => [key, String(value)]))
          return z.object({ page: z.number(), pageSize: z.number(), total: z.number(), items: z.array(siteSchema) }).parse(await api(token(), signal)("GET", `/sites?${query}`))
        },
      },
      {
        name: "pagey_get",
        description: "Get a Pagey site's safe metadata and HTTPS URL.",
        input: z.object({ siteId }),
        execute: async (input: { siteId: string }, signal: AbortSignal) => z.object({ site: siteSchema }).parse(await api(token(), signal)("GET", `/sites/${input.siteId}`)).site,
      },
      {
        name: "pagey_settings",
        description: "Update a site's title, password, or expiry. null removes a setting. Does not change site files. Ask the user before changing access protection.",
        input: settings.extend({ siteId }),
        execute: async (input: { siteId: string; title?: string | null; password?: string | null; expiresAt?: string | null }, signal: AbortSignal, approve: (action: string, resources: string[]) => Promise<void>) => {
          await approve("pagey.settings", [input.siteId])
          return z.object({ site: siteSchema }).parse(await api(token(), signal)("PATCH", `/sites/${input.siteId}`, Object.fromEntries(Object.entries(input).filter(([key, value]) => key !== "siteId" && value !== undefined)))).site
        },
      },
    ]
    const registration = await ctx.tool.transform((editor) => {
      for (const definition of definitions) editor.add({
        name: definition.name,
        description: definition.description,
        input: definition.input,
        options: { codemode: false },
        async execute(raw, context) {
          const approve = (action: string, resources: string[], metadata?: Record<string, unknown>) => ctx.permission.assert({ sessionID: context.sessionID, agent: context.agent, action, resources, metadata, source: { type: "tool", messageID: context.messageID, id: context.id } })
          // The heterogeneous definitions share the same boundary; each validates its own input.
          const input = definition.input.parse(raw)
          const run = definition.execute as (value: typeof input, signal: AbortSignal, authorize: typeof approve) => Promise<unknown>
          const result = JSON.stringify(await run(input, context.signal, approve))
          return { content: token() ? result.replaceAll(token(), "[REDACTED]") : result }
        },
      })
    })
    return () => registration.dispose()
  },
} satisfies Plugin.Plugin

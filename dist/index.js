// @bun
// src/index.ts
import { resolve as resolve2 } from "path";
import { z as z2 } from "zod";

// src/api.ts
import { z } from "zod";
var siteSchema = z.object({
  id: z.string().uuid(),
  subdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  title: z.string().nullable().optional(),
  status: z.string(),
  isPasswordProtected: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string()).optional()
}).transform((site) => ({ ...site, url: `https://${site.subdomain}.pagey.site` }));
function api(token, signal) {
  if (!token.trim())
    throw new Error("Set PAGEY_API_TOKEN in the environment of the OpenCode server, then restart it. Create a token at https://pagey.site/dashboard/api-tokens. Never paste tokens into chat.");
  return async (method, route, body) => {
    const response = await fetch(`https://pagey.site/api${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {} },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      redirect: "error"
    }).catch(() => {
      throw new Error("Pagey request interrupted, timed out, or failed. List sites before retrying: the operation may have completed. No automatic retry was attempted.");
    });
    if (!response.ok) {
      await response.body?.cancel();
      const hint = { 401: "Check PAGEY_API_TOKEN.", 403: "Account does not permit this action.", 404: "Site not found.", 409: "Subdomain unavailable or conflicting request.", 410: "Site expired.", 429: "Rate limit or quota reached; wait before retrying." }[response.status];
      throw new Error(`Pagey HTTP ${response.status}. ${hint ?? "List sites before retrying a mutation."}`);
    }
    return await response.json();
  };
}

// src/upload.ts
import { createHash } from "crypto";
import { lstat, readdir, readFile } from "fs/promises";
import { basename, extname, join, resolve } from "path";
import { zipSync } from "fflate";
var blocked = /(^|\/)(\.[^/]+|node_modules|vendor|coverage|__MACOSX)(\/|$)|\.(pem|key|p12|pfx|sqlite|sqlite3|db|map)$/i;
var credential = /-----BEGIN [A-Z ]*PRIVATE KEY|(?:ghp_|github_pat_|sk-(?:live|test|proj)-|xox[bpas]-)[A-Za-z0-9_-]{8,}/;
var maxBytes = 50 * 1024 * 1024;
async function prepareUpload(path, token) {
  const files = Object.create(null);
  const manifest = [];
  const walk = async (source, name) => {
    if (blocked.test(name))
      throw new Error(`Refusing ${name}: publish a clean build folder without hidden files, secrets, dependencies, or source maps.`);
    const stat = await lstat(source);
    if (stat.isSymbolicLink())
      throw new Error(`Refusing symlink: ${name}`);
    if (stat.isDirectory()) {
      const entries = await readdir(source);
      for (const entry of entries.sort())
        await walk(join(source, entry), name ? `${name}/${entry}` : entry);
      return;
    }
    if (!stat.isFile())
      throw new Error(`Refusing special file: ${name}`);
    if (manifest.length >= 1000 || manifest.reduce((sum, file) => sum + file.bytes, 0) + stat.size > maxBytes)
      throw new Error("Upload limit: 1,000 files and 50 MiB of uncompressed content.");
    const data = await readFile(source);
    const text = data.toString("utf8");
    if (credential.test(text) || token && text.includes(token))
      throw new Error(`Possible credential in ${name}; remove it before publishing.`);
    files[name] = data;
    manifest.push({ path: name, bytes: data.length });
  };
  const source = resolve(path);
  const stat = await lstat(source);
  if (stat.isSymbolicLink())
    throw new Error("Select a real folder or HTML file, not a symlink.");
  if (!stat.isDirectory() && !/\.html?$/i.test(extname(source)))
    throw new Error("Select a static build folder or an HTML file. Extract ZIP archives first.");
  if (!stat.isDirectory() && blocked.test(basename(source)))
    throw new Error("Select a public HTML file.");
  await walk(source, stat.isDirectory() ? "" : "index.html");
  if (!files["index.html"])
    throw new Error("The selected folder must contain index.html at its root. Build your site first and select dist/, out/, or build/.");
  if (manifest.reduce((sum, file) => sum + file.bytes, 0) > maxBytes)
    throw new Error("Upload exceeds 50 MiB.");
  const data = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { mtime: new Date(1980, 0, 1) }]])), { level: 6 });
  if (data.length > maxBytes)
    throw new Error("Compressed upload exceeds 50 MiB.");
  return { data, digest: createHash("sha256").update(data).digest("hex"), files: manifest, bytes: manifest.reduce((sum, file) => sum + file.bytes, 0) };
}

// src/index.ts
var path = z2.string().min(1).describe("Public static build folder or HTML file, relative to the OpenCode location. Build the site first.");
var siteId = z2.string().uuid().describe("Pagey site ID from publish or list");
var settings = z2.object({
  title: z2.string().max(255).nullable().optional(),
  password: z2.string().min(6).nullable().optional().describe("null removes password protection; never include private credentials"),
  expiresAt: z2.iso.datetime({ offset: true }).refine((value) => Date.parse(value) > Date.now(), "Expiry must be in the future").nullable().optional()
});
var src_default = {
  id: "pagey",
  async setup(ctx) {
    const token = () => process.env.PAGEY_API_TOKEN?.trim() ?? "";
    const definitions = [
      {
        name: "pagey_preview",
        description: "Preview the exact public files before publishing to Pagey. Returns a digest required by pagey_publish. Review files and ask the user before uploading. No network requests. Does not run builds.",
        input: z2.object({ path }),
        execute: async (input) => {
          const prepared = await prepareUpload(resolve2(ctx.location.directory, input.path), token());
          return { path: input.path, digest: prepared.digest, bytes: prepared.bytes, files: prepared.files };
        }
      },
      {
        name: "pagey_publish",
        description: "Publish a previewed static build to free Pagey hosting. Needs pagey_preview digest. Omit siteId for a NEW site; pass siteId to REPLACE ALL content at its existing URL. Explain replacement to the user. Returns site ID and HTTPS URL. List sites before retrying failures.",
        input: settings.extend({ path, digest: z2.string().regex(/^[a-f0-9]{64}$/), siteId: siteId.optional(), subdomain: z2.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).optional() }).refine((input) => !input.siteId || [input.title, input.password, input.expiresAt, input.subdomain].every((value) => value === undefined), "Content replacement accepts only path, digest, and siteId. Use pagey_settings for metadata."),
        execute: async (input, signal, approve) => {
          const request = api(token(), signal);
          const prepared = await prepareUpload(resolve2(ctx.location.directory, input.path), token());
          if (prepared.digest !== input.digest)
            throw new Error("Files changed since preview. Run pagey_preview and review the new files before publishing.");
          await approve(input.siteId ? "pagey.replace" : "pagey.publish", [input.siteId ?? "new-site"], { path: input.path, digest: prepared.digest, bytes: prepared.bytes, files: prepared.files, replacesAllContent: Boolean(input.siteId) });
          const form = new FormData;
          form.set("file", new Blob([new Uint8Array(prepared.data)], { type: "application/zip" }), "site.zip");
          if (!input.siteId) {
            if (input.subdomain)
              form.set("customSubdomain", input.subdomain);
            for (const key of ["title", "password", "expiresAt"])
              if (input[key] != null)
                form.set(key, input[key]);
          }
          return z2.object({ site: siteSchema }).parse(await request(input.siteId ? "PUT" : "POST", input.siteId ? `/sites/${input.siteId}/content` : "/sites", form)).site;
        }
      },
      {
        name: "pagey_list",
        description: "List your Pagey sites with IDs and HTTPS URLs. Use to find an existing site before updating or retrying publishing.",
        input: z2.object({ page: z2.number().int().min(1).default(1), pageSize: z2.number().int().min(1).max(100).default(20), search: z2.string().optional(), status: z2.enum(["active", "deleted", "expired"]).optional() }),
        execute: async (input, signal) => {
          const query = new URLSearchParams(Object.entries(input).filter((entry) => entry[1] !== undefined).map(([key, value]) => [key, String(value)]));
          return z2.object({ page: z2.number(), pageSize: z2.number(), total: z2.number(), items: z2.array(siteSchema) }).parse(await api(token(), signal)("GET", `/sites?${query}`));
        }
      },
      {
        name: "pagey_get",
        description: "Get a Pagey site's safe metadata and HTTPS URL.",
        input: z2.object({ siteId }),
        execute: async (input, signal) => z2.object({ site: siteSchema }).parse(await api(token(), signal)("GET", `/sites/${input.siteId}`)).site
      },
      {
        name: "pagey_settings",
        description: "Update a site's title, password, or expiry. null removes a setting. Does not change site files. Ask the user before changing access protection.",
        input: settings.extend({ siteId }),
        execute: async (input, signal, approve) => {
          await approve("pagey.settings", [input.siteId]);
          return z2.object({ site: siteSchema }).parse(await api(token(), signal)("PATCH", `/sites/${input.siteId}`, Object.fromEntries(Object.entries(input).filter(([key, value]) => key !== "siteId" && value !== undefined)))).site;
        }
      }
    ];
    const registration = await ctx.tool.transform((editor) => {
      for (const definition of definitions)
        editor.add({
          name: definition.name,
          description: definition.description,
          input: definition.input,
          options: { codemode: false },
          async execute(raw, context) {
            const approve = (action, resources, metadata) => ctx.permission.assert({ sessionID: context.sessionID, agent: context.agent, action, resources, metadata, source: { type: "tool", messageID: context.messageID, id: context.id } });
            const input = definition.input.parse(raw);
            const run = definition.execute;
            const result = JSON.stringify(await run(input, context.signal, approve));
            return { content: token() ? result.replaceAll(token(), "[REDACTED]") : result };
          }
        });
    });
    return () => registration.dispose();
  }
};
export {
  src_default as default
};

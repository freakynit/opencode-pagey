import { z } from "zod"

export const siteSchema = z.object({
  id: z.string().uuid(),
  subdomain: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  title: z.string().nullable().optional(),
  status: z.string(),
  isPasswordProtected: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).transform((site) => ({ ...site, url: `https://${site.subdomain}.pagey.site` }))

export function api(token: string, signal?: AbortSignal) {
  if (!token.trim()) throw new Error("Set PAGEY_API_TOKEN in the environment of the OpenCode server, then restart it. Create a token at https://pagey.site/dashboard/api-tokens. Never paste tokens into chat.")
  return async (method: string, route: string, body?: FormData | Record<string, unknown>) => {
    const response = await fetch(`https://pagey.site/api${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
      redirect: "error",
    }).catch(() => { throw new Error("Pagey request interrupted, timed out, or failed. List sites before retrying: the operation may have completed. No automatic retry was attempted.") })
    if (!response.ok) {
      await response.body?.cancel()
      const hint = { 401: "Check PAGEY_API_TOKEN.", 403: "Account does not permit this action.", 404: "Site not found.", 409: "Subdomain unavailable or conflicting request.", 410: "Site expired.", 429: "Rate limit or quota reached; wait before retrying." }[response.status]
      throw new Error(`Pagey HTTP ${response.status}. ${hint ?? "List sites before retrying a mutation."}`)
    }
    return await response.json() as unknown
  }
}

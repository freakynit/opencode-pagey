<div align="center">

# OpenCode × Pagey

### Build it in a conversation. Publish it before you leave.

**Free static hosting. Unlimited total sites. A real HTTPS URL.**

[![CI](https://github.com/freakynit/opencode-pagey/actions/workflows/ci.yml/badge.svg)](https://github.com/freakynit/opencode-pagey/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-a8df82)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-v2-compatible)](https://opencode.ai/v2/docs/plugins)

[Live demo](https://autumn-pond-moss.pagey.site) · [Pagey](https://pagey.site) · [API reference](https://pagey.site/api-docs) · [Report an issue](https://github.com/freakynit/opencode-pagey/issues)

</div>

> “Publish `dist` to Pagey and give me the link.”

That’s the workflow. Your OpenCode agent previews the build, requests permission,
and publishes it. Next time, ask it to update the existing site — the URL stays the same.

Use it for portfolios, landing pages, prototypes, documentation, event pages,
and client previews. No deployment pipeline, cloud project, or credit card required.

## Start publishing

Requires **OpenCode v2**. The older `/docs/plugins/` page describes the v1 API;
use the [v2 plugin documentation](https://opencode.ai/v2/docs/plugins).
This plugin uses the v2 Promise SDK and does not support v1.

### 1. Install

```sh
opencode plugin add github:freakynit/opencode-pagey#v1.0.0
```

Or add this entry to the `plugins` array in your `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:freakynit/opencode-pagey#v1.0.0"]
}
```

The release includes built JavaScript, so installation needs no build step.
GitHub is the distribution source; this package is not currently published on npm.

### 2. Connect Pagey

1. [Create a free account](https://pagey.site/signup).
2. Create an [API token](https://pagey.site/dashboard/api-tokens).
3. Set `PAGEY_API_TOKEN` in the environment of the **OpenCode server process**.

For example, in your terminal (enter the value locally, never in chat):

```sh
export PAGEY_API_TOKEN="your-pagey-api-token"
opencode service restart
```

For a desktop app or a separately managed background service, configure the token
in that process’s launch environment and restart it. A client shell variable does
not configure a server that is already running elsewhere. For a private server
started directly from the configured shell, use `opencode --standalone`.

Do not put API tokens in `opencode.json`, prompts, or committed files. The plugin
reads the environment; it never writes a credentials file or offers a token argument.

### 3. Ask OpenCode

```text
Build this site, then preview and publish dist to Pagey.
Use my-portfolio as the subdomain if it is available.
```

```text
Find my portfolio on Pagey and replace its content with the latest dist build.
Keep the same URL.
```

```text
List my Pagey sites matching “portfolio”.
```

```text
Change that site's title to “My portfolio”.
```

The plugin handles publishing and site management. Your agent uses its normal
build tools to produce static output first. It does not guess a folder, execute
package scripts, or automatically publish whenever a file changes.

## What you get

| Feature | How it works |
| --- | --- |
| Free hosting with no total-site cap | Registered Pagey account, no subscription or card |
| Automatic HTTPS | `https://your-subdomain.pagey.site` |
| Custom Pagey subdomain | Choose a slug when creating a site |
| Folder or single-file publishing | Upload a build directory, or any `.html` / `.htm` file as `index.html` |
| Asset support | Nested CSS, JavaScript, images, fonts, and other public build files |
| Updates at the same address | Replace the existing site's complete content using its site ID |
| Find previous deployments | Paginated listing with search and status filters |
| Titles, expiry, and password protection | Update metadata; `null` clears a setting |
| Review before publishing | File manifest, byte count, SHA-256 digest, and OpenCode permissions |

**“Unlimited” means no cap on total sites, not unrestricted usage.** Registered
accounts can create **25 new sites per UTC day**; updates do not consume that
new-site allowance. The plugin limits each upload to **1,000 files / 50 MiB**;
Pagey also enforces upload and request limits. See [Pagey's current allowances](https://pagey.site/llms.txt).

Static output only: hosted sites do not run Node.js, PHP, SSR, or your API server.
Export your framework to static files first. The selected folder needs a root
`index.html`; extract existing ZIP archives before using this plugin.

## Tools and permissions

| Tool | Purpose |
| --- | --- |
| `pagey_preview` | Read a local build and return files, total bytes, and upload digest |
| `pagey_publish` | Create a site, or replace content when `siteId` is provided |
| `pagey_list` | Find sites by page, search, or status |
| `pagey_get` | Retrieve safe site metadata and its public URL |
| `pagey_settings` | Change title, expiry, or password protection |

Mutation tools call OpenCode’s permission system using `pagey.publish`,
`pagey.replace`, and `pagey.settings`. Your OpenCode permission policy determines
whether an approval prompt appears. Replacing content removes old files; it does
not merge directories. Site deletion is intentionally outside this plugin’s tools.

Publishing requires the digest from a preceding preview. Changed files invalidate
that digest; the agent must preview again. The approved upload uses the bytes
already read into memory. Files are zipped with deterministic timestamps.

Hidden paths (including `.env`, `.git`, and `.well-known`), dependency folders,
source maps, databases, key files, symlinks, private-key content, common credential
prefixes, and files containing your Pagey token are rejected. These checks are
limited safeguards: **review the manifest and publish only public build output**.

The token is sent only in the Authorization header to `https://pagey.site/api`.
Requests reject redirects, honor cancellation, and time out after 60 seconds.
Mutations are never retried automatically: list your sites before retrying a
failed upload, because the server may already have completed it. API errors omit
remote error bodies, and returned site metadata excludes internal storage and
account fields. No extra telemetry is collected by the plugin.

## Troubleshooting

- **Missing token / HTTP 401:** configure the server's environment and restart it.
- **Missing `index.html`:** select `dist`, `out`, or `build`, rather than your source root.
- **Rejected source map or hidden file:** produce a clean public build, then preview again.
- **Changed digest:** files changed after the preview; run a new preview.
- **HTTP 409:** select a different custom subdomain.
- **HTTP 429:** wait for the request limit or daily creation allowance to reset.
- **Upload interrupted:** use `pagey_list` before retrying to avoid duplicate sites.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Checks include official TypeScript checking, Bun tests, and a production build.
Tests cover real ZIP output, stable/changed digests, upload exclusions, token
content rejection, permission denial, SDK registration, and API projection.
Live validation also exercised create → serve HTML/CSS → replace → settings →
get → list against Pagey on October 29, 2026.

`dist/` is committed for Git installation. After changing `src/`, run `bun run build:plugin`
and commit the result. CI checks that the committed build matches the source.
The SDK is a development dependency; runtime dependencies are `zod` and `fflate`.

Independent community plugin; not an official OpenCode or Pagey integration.
Pagey runs the hosting service and sets its terms and allowances.

Also using Herdr? See [herdr-pagey](https://github.com/freakynit/herdr-pagey).

## License

[MIT](LICENSE).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

alist-encrypt-cli is a CLI tool for encrypting/decrypting files for alist. It provides:
- CLI commands for local file encryption and proxy server
- An HTTP proxy server that sits between clients and alist, transparently encrypting uploads and decrypting downloads
- A Web console (React SPA) for configuration management, local encrypt/decrypt with SSE progress

## Commands

```bash
# Development
bun run dev             # Start proxy server in dev mode (with web HMR)
bun run compile         # Compile to single binary at bin/alist-encrypt
bun run build           # Build to dist/ with sourcemaps
bun run lint            # Run biome linter/formatter
bun run test            # Run tests

# CLI (after compile)
alist-encrypt encrypt <input> -p <password> -o <output>
alist-encrypt server [--port <port>]
```

## Architecture

### Entry Point
- `src/main.ts` — Parses CLI args, starts server or runs encrypt command, serves built web assets

### Server (`src/server/`)
- **`server.ts`** — Bun.serve() HTTP server. Routes defined as `method + regex pattern → handler`. Console API routes under `/@console/api/*`. Live config reload: `buildRoutes()` and `getConfig()` called per-request.
- **`proxy.ts`** — Core proxy using `fetch()` for upstream requests. `httpProxy()` handles encrypt/decrypt transforms via `pipeThroughTransform()` bridging Node.js Transform streams to Web ReadableStream. Strips `Authorization` header only for `/@console` requests (preserves alist auth).
- **`config.ts`** — Portable config: `./config/config.json` takes priority over `~/.config/alist-encrypt/config.json`. `initAlistConfig()` cleans up legacy `origEncPath` fields. `saveConfig()` writes and updates cache.
- **`storage.ts`** — In-memory TTL cache (Map-based). `cacheFileInfo()` / `cacheRedirect()`. Generic `set()`/`get()` for `encMap` entries.
- **`logger.ts`** — Writes to log dir and console. `logFile` config controls file logging.
- **`utils/common.ts`** — `expandEncPath()` expands simple paths to `/d/`, `/p/`, `/dav/` prefixed versions. `pathFindPasswd()` calls `expandEncPath()` per-request for dynamic matching. `encodeName()`/`decodeName()` using CRC6 + MixBase64.

### Web Console (`src/web/`)
- **`app.tsx`** — React SPA with HashRouter. Routes: `/login` (AuthLayout), `/home`, `/settings`, `/encrypt` (AppLayout). Fetches lang from `GET /@console/api/lang` (no auth) on mount.
- **`i18n/`** — I18nProvider context, `useI18n()` hook, `t()` with `{param}` interpolation. `en.ts` (base), `zh.ts`.
- **`layouts/AppLayout.tsx`** — Sidebar (desktop) / hamburger menu (mobile). `h-screen` viewport constraint.
- **`layouts/AuthLayout.tsx`** — Centered login form.
- **`pages/Settings.tsx`** — Full config editor (Basic, JWT, Alist Server, Encryption Rules, WebDAV). Port change triggers server restart.
- **`pages/Encrypt.tsx`** — Local encrypt/decrypt with SSE progress streaming. Mode toggle, algorithm selector, filename encryption option.

### Console API Routes
- `GET/POST /@console/api/settings` — Read/write config (passwords masked)
- `POST /@console/api/restart` — Server restart for port changes
- `POST /@console/api/encrypt` — SSE streaming encrypt/decrypt with progress
- `GET /@console/api/cwd` — Current working directory
- `GET/POST /@console/api/lang` — Language preference (no auth required for GET)
- `POST /@console/api/login` — JWT login

### Encryption Libraries (`src/libs/`)
- **`flow-enc.ts`** — Facade: `encType` selects AesCTR / Rc4Md5 / MixEnc. Exposes `encryptTransform()` / `decryptTransform()` (Transform streams). `getPassWdOutward()` for password derivation.
- **`aes-ctr.ts`** — AES-128-CTR encryption
- **`rc4-md5.ts`** — RC4-MD5 encryption (symmetric: same function for encrypt/decrypt)
- **`mix-enc.ts`** — XOR-based encryption
- **`mix-base64.ts`** — Custom base64 for filename encryption
- **`types.ts`** — `PasswdInfo`, `ServerConfig`, `WebdavConfig`, `RedirectData` types

### Key Data Flow

**Upload (PUT):** Client → proxy encrypts via FlowEnc → upstream alist

**Download:** Client → proxy matches `encPath` → gets file size (cached or HEAD) → FlowEnc decrypts → streamed to client. Redirects (3xx) cached as `/redirect/:key`.

**Filename decryption (UI):** `handleFsList` intercepts `/api/fs/list` responses, decodes encrypted filenames, builds `encMap:decryptedPath → encryptedPath`. `handleFsGet`/`handleProxy` reverse-lookup via `encMap`.

### Path Matching
`pathFindPasswd()` calls `expandEncPath()` per-request. Expands simple user paths (e.g. `private/encrypt2/*`) to `/d/...`, `/p/...`, `/dav/...` prefixed versions. Handles both alist API paths and UI direct access.

### Live Config Reload
Config and routes are rebuilt on every request via `getConfig()` and `buildRoutes()` in `buildFetchHandler()`. No restart needed for encryption rule changes. Port changes require server restart via `/@console/api/restart`.

### Path Alias
`@/*` maps to `./src/*` (tsconfig.json). Use `@/libs/` for encryption, `@/server/` for server modules.

## Configuration

Portable config: `./config/config.json` (next to executable). Fallback: `~/.config/alist-encrypt/config.json`.

Key fields:
- `port` — proxy listen port (default 5344)
- `password` — console login password
- `jwtSecret` / `jwtExpiresIn` — JWT auth config
- `web.lang` — UI language (`en` / `zh`)
- `logFile` — enable file logging
- `alistServer.serverHost` / `serverPort` — upstream alist
- `alistServer.passwdList[]` — encryption rules: `password`, `encType` (aesctr/rc4/mix), `enable`, `encName`, `encPath` (simple globs, expanded at runtime)

## Tech Stack

- **Runtime**: Bun (Bun.serve, Bun.file, bun build --compile)
- **Frontend**: React 19 + react-router-dom (HashRouter) + Tailwind CSS 4 + lucide-react
- **Auth**: @tsndr/cloudflare-worker-jwt
- **Lint**: Biome
- **Zero runtime deps** for encryption (Node.js built-ins only)

## Notes

- All imports use `.js` extensions (required for ESM resolution)
- Console uses `console_token` localStorage key (not `token`, which alist uses)
- Compiled binary embeds `dist/index.html` via `import(..., { with: { type: "text" } })`
- `encPath` in config stores simple user paths; `expandEncPath()` handles runtime expansion
- i18n: `en.ts` is the base language; add new keys there first, then translate in `zh.ts`

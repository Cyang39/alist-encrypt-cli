# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

alist-encrypt-cli is a CLI tool for encrypting/decrypting files for alist (a file listing program). It provides:
- A CLI command for local file encryption
- An HTTP proxy server that sits between clients and alist, transparently encrypting uploads and decrypting downloads

## Commands

```bash
# Development
bun run server          # Start proxy server in development mode
bun run compile         # Compile to single binary at bin/alist-encrypt
bun run build           # Build to dist/ with sourcemaps
bun run lint            # Run biome linter/formatter

# Local file encryption
alist-encrypt encrypt <input> -p <password> -o <output>

# Start proxy server
alist-encrypt server [--port <port>]
```

## Architecture

### Entry Point
- `src/cli.ts` — CLI entry: parses commands (`encrypt`, `server`) via `node:util` parseArgs, dynamically imports the appropriate module

### Server (`src/server/`)
- **`server.ts`** — Bun.serve() HTTP server with route matching. Routes are defined as `method + regex pattern → handler`. Uses a per-request `Map<Request, ProxyContext>` for passing upstream URL and config between `preProxy()` and handlers.
- **`proxy.ts`** — Core proxy using `fetch()` for upstream requests. `httpProxy()` handles encrypt/decrypt transforms via `pipeThroughTransform()` which bridges Node.js `Transform` streams to Web `ReadableStream`. Also handles redirect caching and Content-Disposition filename decryption.
- **`config.ts`** — Loads config from `~/.config/alist-encrypt/config.json`. `initAlistConfig()` expands `encPath` entries with `/d/`, `/p/`, `/dav/` prefixes and saves originals to `origEncPath`.
- **`storage.ts`** — In-memory TTL cache (Map-based). `cacheFileInfo()` / `cacheRedirect()` for file metadata and redirect URLs. Generic `set()`/`get()` used for `encMap` entries.
- **`logger.ts`** — Writes to `~/.config/alist-encrypt/logs/YYYY-MM-DD.log` and console.
- **`types.ts`** — `PasswdInfo`, `ServerConfig`, `WebdavConfig`, `RedirectData` types.
- **`utils/common.ts`** — `globToRegex()`, `pathExec()`, `pathFindPasswd()` (checks both `encPath` and `origEncPath`), `encodeName()`/`decodeName()` using CRC6 + MixBase64.

### Encryption Libraries (`src/libs/`)
- **`flow-enc.ts`** — Facade that selects algorithm by `encType`: `aesctr` → AesCTR, `rc4` → Rc4Md5, `mix` → MixEnc. Exposes `encryptTransform()` / `decryptTransform()` (Node.js Transform streams). `getPassWdOutward()` static method for password derivation.
- **`aes-ctr.ts`** — AES-128-CTR encryption
- **`rc4-md5.ts`** — RC4-MD5 encryption
- **`mix-enc.ts`** — XOR-based encryption
- **`crc.ts`** — CRC checksum
- **`mix-base64.ts`** — Custom base64 encoding for filename encryption

### Key Data Flow

**Upload (PUT):** Client → proxy encrypts via FlowEnc → upstream alist

**Download:** Client → proxy matches `encPath` → gets file size (cached or HEAD) → FlowEnc decrypts → streamed to client. Redirects (3xx) are cached as `/redirect/:key` to carry decryption context.

**Filename decryption (UI):** `handleFsList` intercepts `/api/fs/list` responses, decodes encrypted filenames, and builds `encMap:decryptedPath → encryptedPath`. When client clicks a decrypted file, `handleFsGet` and `handleProxy` use `encMap` to reverse-lookup the encrypted path.

### Path Matching

`pathFindPasswd()` is the central matcher. It checks `encPath` (expanded with `/d/`, `/p/`, `/dav/` prefixes) first, then `origEncPath` (unprefixed, normalized with leading `/`). This handles both alist API paths (`/d/private/encrypt2/...`) and UI direct access (`/private/encrypt2/...`).

### Path Alias
`@/*` maps to `./src/*` (tsconfig.json paths). Use `@/libs/` for encryption, `@/server/` for server modules.

## Configuration

Config file: `~/.config/alist-encrypt/config.json`

Key fields:
- `port` — proxy listen port (default 5344)
- `alistServer.serverHost` / `serverPort` — upstream alist server
- `alistServer.passwdList[]` — encryption configs: `password`, `encType` (aesctr/rc4/mix), `enable`, `encName` (filename encryption), `encPath` (glob patterns)

## Notes

- Zero runtime dependencies — only Bun/Node.js built-ins and TypeScript
- Compiled binary via `bun build --compile`
- All imports use `.js` extensions (required for ESM resolution)

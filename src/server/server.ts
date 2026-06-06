import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import jwt from "@tsndr/cloudflare-worker-jwt";
import FlowEnc from "@/libs/crypto/flow-enc.js";
import type { EncType, PasswdInfo, ServerConfig } from "@/libs/types.js";
import {
  getConfig,
  initAlistConfig,
  loadConfig,
  saveConfig,
} from "./config.js";
import logger, { setFileLog } from "./logger.js";
import { httpClient, httpProxy } from "./proxy.js";
import * as storage from "./storage.js";
import {
  decodeName,
  encodeName,
  globToRegex,
  pathExec,
  pathFindPasswd,
} from "./utils/common.js";

// Web UI - 从 dist/index.html 导入（编译时嵌入）
let consoleHtmlBody: string;
try {
  const mod = await import("../../dist/index.html", { with: { type: "text" } });
  consoleHtmlBody = mod.default as unknown as string;
} catch {
  consoleHtmlBody = "<h1>Web UI not built. Run: bun run build:web</h1>";
}

// ==================== 路由定义 ====================

interface Route {
  method: string | "*";
  pattern: RegExp;
  handler: (req: Request, match: RegExpMatchArray) => Promise<Response>;
}

function route(
  method: string,
  pattern: string,
  handler: Route["handler"],
): Route {
  return { method, pattern: new RegExp(`^${pattern}$`), handler };
}

function buildRoutes(): Route[] {
  const config = getConfig();
  return [
    // /redirect/:key
    route("*", "/redirect/([^/]+)", handleRedirect),
    // /@console/api/login
    route("POST", "/@console/api/login", handleLogin),
    // /@console/api/settings
    route("GET", "/@console/api/settings", handleGetSettings),
    route("POST", "/@console/api/settings", handleSaveSettings),
    // /@console/api/restart
    route("POST", "/@console/api/restart", handleRestart),
    // /@console/api/cwd
    route("GET", "/@console/api/cwd", handleCwd),
    // /@console/api/lang
    route("GET", "/@console/api/lang", handleGetLang),
    route("POST", "/@console/api/lang", handleSaveLang),
    // /@console/api/encrypt
    route("POST", "/@console/api/encrypt", handleEncrypt),
    // /api/fs/get
    route("*", "/api/fs/get", handleFsGet),
    // /api/fs/list
    route("*", "/api/fs/list", handleFsList),
    // /api/fs/put-back
    route("PUT", "/api/fs/put-back", handleFsPutBack),
    // /d/* 下载
    route("GET", "/d/(.*)", handleProxy),
    // /p/* 直接下载
    route("GET", "/p/(.*)", handleProxy),
    // /dav/* WebDAV
    route("*", "/dav/(.*)", handleProxy),
    // /@console Web UI
    route("GET", "/@console", handleConsole),
    // catch-all 代理（glob → regex）
    {
      method: "*",
      pattern: globToRegex(config.alistServer.path),
      handler: handleProxy,
    },
  ];
}

// ==================== 上下文 ====================

interface ProxyContext {
  urlAddr: string;
  serverAddr: string;
  webdavConfig: { passwdList: PasswdInfo[] } & Record<string, unknown>;
  selfHost: string;
  origin?: string;
  isWebdav?: boolean;
  fileSize?: number;
}

const ctx = new Map<Request, ProxyContext>();

function setCtx(request: Request, data: ProxyContext): void {
  ctx.set(request, data);
}

function getCtx(request: Request): ProxyContext | undefined {
  return ctx.get(request);
}

function cleanupCtx(request: Request): void {
  ctx.delete(request);
}

/**
 * preProxy：构建上游地址
 */
function preProxy(
  serverConfig: {
    serverHost: string;
    serverPort: number;
    https: boolean;
    passwdList: PasswdInfo[];
  },
  request: Request,
  isWebdav: boolean,
): void {
  const { serverHost, serverPort, https } = serverConfig;
  const url = new URL(request.url);
  const protocol = https ? "https" : "http";
  const host = `${serverHost}:${serverPort}`;

  setCtx(request, {
    urlAddr: `${protocol}://${host}${url.pathname}${url.search}`,
    serverAddr: `${protocol}://${host}`,
    webdavConfig: serverConfig,
    selfHost: request.headers.get("host") ?? "",
    origin: request.headers.get("origin") ?? undefined,
    isWebdav,
  });
}

// ==================== 路由处理 ====================

async function handleConsole(_request: Request): Promise<Response> {
  return new Response(consoleHtmlBody, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match?.[1] || !match?.[2]) return 7 * 24 * 60 * 60; // 默认 7 天
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 24 * 60 * 60;
    default:
      return 7 * 24 * 60 * 60;
  }
}

async function handleLogin(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { password?: string };
    const config = getConfig();
    const correctPassword = config.password ?? "123456";
    const jwtSecret = config.jwtSecret ?? "alist-encrypt-secret";
    const jwtExpiresIn = config.jwtExpiresIn ?? "7d";

    if (body.password === correctPassword) {
      const expiresIn = parseExpiresIn(jwtExpiresIn);
      const exp = Math.floor(Date.now() / 1000) + expiresIn;
      const token = await jwt.sign(
        { exp, iat: Math.floor(Date.now() / 1000) },
        jwtSecret,
      );
      return Response.json({ success: true, token });
    }
    return Response.json(
      { success: false, message: "Invalid password" },
      { status: 401 },
    );
  } catch {
    return Response.json(
      { success: false, message: "Invalid request" },
      { status: 400 },
    );
  }
}

export async function verifyToken(request: Request): Promise<boolean> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7);
  const config = getConfig();
  const jwtSecret = config.jwtSecret ?? "alist-encrypt-secret";
  return !!(await jwt.verify(token, jwtSecret));
}

async function handleGetSettings(request: Request): Promise<Response> {
  if (!(await verifyToken(request))) {
    return Response.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }
  const config = getConfig();
  // Mask password in passwdList for security
  const safeConfig = structuredClone(config);
  for (const p of safeConfig.alistServer.passwdList) {
    p.password = "******";
  }
  for (const w of safeConfig.webdavServer) {
    for (const p of w.passwdList) {
      p.password = "******";
    }
  }
  return Response.json({ success: true, config: safeConfig });
}

async function handleSaveSettings(request: Request): Promise<Response> {
  if (!(await verifyToken(request))) {
    return Response.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }
  try {
    const body = (await request.json()) as { config?: ServerConfig };
    if (!body.config) {
      return Response.json(
        { success: false, message: "Missing config" },
        { status: 400 },
      );
    }
    const newConfig = body.config;
    // Validate required fields
    if (
      !newConfig.alistServer?.serverHost ||
      !newConfig.alistServer?.passwdList
    ) {
      return Response.json(
        { success: false, message: "Invalid config: missing alistServer" },
        { status: 400 },
      );
    }
    // Restore masked passwords with current passwords
    const currentConfig = getConfig();
    for (const p of newConfig.alistServer.passwdList) {
      if (p.password === "******") {
        const orig = currentConfig.alistServer.passwdList.find(
          (cp) => cp.describe === p.describe,
        );
        if (orig) p.password = orig.password;
      }
    }
    for (const w of newConfig.webdavServer) {
      const curW = currentConfig.webdavServer.find((cw) => cw.id === w.id);
      if (curW) {
        for (const p of w.passwdList) {
          if (p.password === "******") {
            const orig = curW.passwdList.find(
              (cp) => cp.describe === p.describe,
            );
            if (orig) p.password = orig.password;
          }
        }
      }
    }
    saveConfig(newConfig);
    initAlistConfig(newConfig.alistServer);
    for (const w of newConfig.webdavServer) {
      if (w.enable) {
        initAlistConfig(w as Parameters<typeof initAlistConfig>[0]);
      }
    }
    logger.info("[settings] Configuration saved and reloaded");
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { success: false, message: "Invalid request body" },
      { status: 400 },
    );
  }
}

async function handleCwd(): Promise<Response> {
  return Response.json({ success: true, cwd: process.cwd() });
}

async function handleGetLang(): Promise<Response> {
  const config = getConfig();
  return Response.json({ success: true, lang: config.web?.lang ?? "en" });
}

async function handleSaveLang(request: Request): Promise<Response> {
  if (!(await verifyToken(request))) {
    return Response.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }
  try {
    const body = (await request.json()) as { lang?: string };
    if (!body.lang) {
      return Response.json(
        { success: false, message: "Missing lang" },
        { status: 400 },
      );
    }
    const config = getConfig();
    config.web = { ...config.web, lang: body.lang };
    saveConfig(config);
    logger.info(`[lang] Language saved: ${body.lang}`);
    return Response.json({ success: true });
  } catch {
    return Response.json(
      { success: false, message: "Invalid request" },
      { status: 400 },
    );
  }
}

async function handleRestart(request: Request): Promise<Response> {
  if (!(await verifyToken(request))) {
    return Response.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }
  try {
    const result = restartServer();
    return Response.json(result);
  } catch (err) {
    logger.error("[restart] Failed:", err);
    return Response.json(
      { success: false, message: "Restart failed" },
      { status: 500 },
    );
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function handleEncrypt(request: Request): Promise<Response> {
  if (!(await verifyToken(request))) {
    return Response.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as {
    inputDir?: string;
    outputDir?: string;
    password?: string;
    encType?: string;
    encName?: boolean;
    mode?: string;
  };

  if (!body.inputDir || !body.outputDir || !body.password) {
    return Response.json(
      { success: false, message: "Missing inputDir, outputDir, or password" },
      { status: 400 },
    );
  }

  const inputDir = body.inputDir;
  const outputDir = body.outputDir;
  const password = body.password;
  const encName = body.encName ?? false;
  const mode = body.mode === "decrypt" ? "decrypt" : "encrypt";

  // Validate input directory exists
  try {
    const s = await stat(inputDir);
    if (!s.isDirectory()) {
      return Response.json(
        { success: false, message: "Input path is not a directory" },
        { status: 400 },
      );
    }
  } catch {
    return Response.json(
      { success: false, message: "Input directory not found" },
      { status: 400 },
    );
  }

  const encType = body.encType ?? "aesctr";

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const files = await collectFiles(inputDir);
        const total = files.length;

        if (total === 0) {
          send({ type: "done", total: 0, success: 0, failed: 0 });
          controller.close();
          return;
        }

        send({
          type: "start",
          total,
          files: files.map((f) => path.relative(inputDir, f)),
        });

        let success = 0;
        let failed = 0;

        for (let i = 0; i < files.length; i++) {
          const filePath = files[i] as string;
          const relativePath = path.relative(inputDir, filePath);
          let outputPath = path.join(outputDir, relativePath);

          // Encrypt/decrypt filename if enabled
          if (encName) {
            const dir = path.dirname(relativePath);
            const ext = path.extname(relativePath);
            const base = path.basename(relativePath, ext);
            if (mode === "encrypt") {
              const encBase = encodeName(password, encType as EncType, base);
              outputPath = path.join(outputDir, dir, encBase + ext);
            } else {
              const decoded = decodeName(password, encType as EncType, base);
              if (decoded) {
                outputPath = path.join(outputDir, dir, decoded + ext);
              }
            }
          }

          send({
            type: "progress",
            current: i + 1,
            total,
            file: relativePath,
            status: mode === "encrypt" ? "encrypting" : "decrypting",
          });

          try {
            const fileStats = await stat(filePath);
            const sizeSalt = fileStats.size;
            const flowEnc = new FlowEnc(password, encType as EncType, sizeSalt);

            // Ensure output directory exists
            const { mkdirSync } = await import("node:fs");
            mkdirSync(path.dirname(outputPath), { recursive: true });

            const input = createReadStream(filePath);
            const output = createWriteStream(outputPath);
            const transform =
              mode === "encrypt"
                ? flowEnc.encryptTransform()
                : flowEnc.decryptTransform();
            await pipeline(input, transform, output);

            success++;
            send({
              type: "progress",
              current: i + 1,
              total,
              file: relativePath,
              status: "done",
            });
          } catch (err) {
            failed++;
            send({
              type: "progress",
              current: i + 1,
              total,
              file: relativePath,
              status: "error",
              error: String(err),
            });
          }
        }

        send({ type: "done", total, success, failed });
      } catch (err) {
        send({ type: "error", error: String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function handleRedirect(
  request: Request,
  match: RegExpMatchArray,
): Promise<Response> {
  const key = match[1] ?? "";
  const data = storage.getRedirect(key) as {
    url: string;
    passwdInfo: PasswdInfo;
    fileSize: number;
    encFileName?: string;
  } | null;

  if (!data) {
    return new Response("not found", { status: 404 });
  }

  const { url: redirectUrl, passwdInfo, fileSize } = data;
  const requestUrl = new URL(request.url);
  const range = request.headers.get("range");
  const start = range
    ? Number.parseInt(range.replace("bytes=", "").split("-")[0] ?? "0", 10)
    : 0;

  const decode = requestUrl.searchParams.get("decode");
  const lastUrl = decodeURIComponent(
    requestUrl.searchParams.get("lastUrl") ?? "",
  );
  const encFileName =
    data.encFileName ||
    decodeURIComponent(requestUrl.searchParams.get("encName") || "");

  logger.debug(
    `[redirect] key=${key} fileSize=${fileSize} encType=${passwdInfo.encType} decode=${decode} lastUrl=${lastUrl}`,
  );
  logger.debug(`[redirect] upstream url: ${redirectUrl}`);

  const flowEnc = new FlowEnc(
    passwdInfo.password,
    passwdInfo.encType,
    fileSize,
  );
  if (start) {
    await flowEnc.setPosition(start);
  }

  // 构建新的请求用于代理
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("referer");
  headers.delete("authorization");

  const proxyReq = new Request(redirectUrl, {
    method: request.method,
    headers,
  });

  let decryptTransform = null;
  if (passwdInfo.enable && pathExec(passwdInfo.encPath, lastUrl)) {
    decryptTransform = flowEnc.decryptTransform();
  }
  if (decode) {
    decryptTransform = decode !== "0" ? flowEnc.decryptTransform() : null;
  }

  logger.debug(
    `[redirect] decrypt: ${decryptTransform ? "YES" : "NO"} (enable=${passwdInfo.enable}, pathExec=${pathExec(passwdInfo.encPath, lastUrl) ? "match" : "no-match"})`,
  );

  try {
    return await httpProxy(redirectUrl, proxyReq, {
      decryptTransform: decryptTransform ?? undefined,
      passwdInfo,
      fileSize,
      encFileName,
      removeHost: true,
    });
  } finally {
    cleanupCtx(request);
  }
}

async function handleProxy(request: Request): Promise<Response> {
  const proxyCtx = getCtx(request);
  if (!proxyCtx) {
    return new Response("no context", { status: 500 });
  }
  const config = getConfig();

  const range = request.headers.get("range");
  const start = range
    ? Number.parseInt(range.replace("bytes=", "").split("-")[0] ?? "0", 10)
    : 0;

  const requestUrl = new URL(request.url);
  const decodedUrl = decodeURIComponent(
    requestUrl.pathname + requestUrl.search,
  );
  const match = pathFindPasswd(config.alistServer.passwdList, decodedUrl);
  const passwdInfo = "passwdInfo" in match ? match.passwdInfo : undefined;

  logger.debug(
    `[proxy] ${request.method} ${decodedUrl} | passwdInfo: ${passwdInfo ? `${passwdInfo.encType}/${passwdInfo.enable}` : "null"}`,
  );
  if (passwdInfo) {
    logger.debug(
      `[proxy] encPath match for ${decodedUrl}: encPath=${JSON.stringify(passwdInfo.encPath)}`,
    );
  }

  // MOVE 请求重写 Destination
  if (request.method.toUpperCase() === "MOVE") {
    const destination = request.headers.get("destination");
    if (destination) {
      const destUrl = new URL(destination, request.url);
      const newDest = `${proxyCtx.serverAddr}${destUrl.pathname}${destUrl.search}`;
      const headers = new Headers(request.headers);
      headers.set("destination", newDest);
      const newReq = new Request(request, { headers });
      try {
        return await httpProxy(proxyCtx.urlAddr, newReq, { removeHost: true });
      } finally {
        cleanupCtx(request);
      }
    }
  }

  // PUT 上传
  if (request.method.toUpperCase() === "PUT" && passwdInfo) {
    const contentLength =
      request.headers.get("content-length") ||
      request.headers.get("x-expected-entity-length") ||
      "0";
    const fileSize = Number.parseInt(contentLength, 10);
    if (fileSize === 0) {
      try {
        return await httpProxy(proxyCtx.urlAddr, request, { removeHost: true });
      } finally {
        cleanupCtx(request);
      }
    }
    const flowEnc = new FlowEnc(
      passwdInfo.password,
      passwdInfo.encType,
      fileSize,
    );
    try {
      return await httpProxy(proxyCtx.urlAddr, request, {
        encryptTransform: flowEnc.encryptTransform(),
        passwdInfo,
        fileSize,
        removeHost: true,
      });
    } finally {
      cleanupCtx(request);
    }
  }

  // GET/HEAD/POST 下载
  if (
    ["GET", "HEAD", "POST"].includes(request.method.toUpperCase()) &&
    passwdInfo
  ) {
    let filePath = requestUrl.pathname;
    if (filePath.startsWith("/p/")) filePath = filePath.replace("/p/", "/");
    if (filePath.startsWith("/d/")) filePath = filePath.replace("/d/", "/");

    let fileSize = 0;
    let fileInfo = storage.getFileInfo(filePath) as Record<
      string,
      unknown
    > | null;

    logger.debug(
      `[decrypt] lookup fileInfo for: ${filePath}, found: ${!!fileInfo}`,
    );

    // 尝试通过 encMap 反向查找加密路径（UI 显示解密名，存储用加密名）
    if (!fileInfo) {
      const encMapPath = storage.get<string>(`encMap:${filePath}`);
      if (encMapPath) {
        logger.debug(`[decrypt] encMap hit: ${filePath} -> ${encMapPath}`);
        const encUrlAddr = proxyCtx.urlAddr.replace(filePath, encMapPath);
        fileInfo = storage.getFileInfo(encMapPath) as Record<
          string,
          unknown
        > | null;
        if (fileInfo) {
          filePath = encMapPath;
          proxyCtx.urlAddr = encUrlAddr;
        }
      }
    }

    // 尝试加密文件名后重查
    if (!fileInfo) {
      const rawFileName = decodeURIComponent(path.basename(filePath));
      const ext = path.extname(rawFileName);
      const encodedRawFileName = encodeURIComponent(rawFileName);
      const encFileName = encodeName(
        passwdInfo.password,
        passwdInfo.encType,
        rawFileName,
      );
      const newFileName = encFileName + ext;
      const encodedFilePath = filePath.replace(encodedRawFileName, newFileName);
      const encodedUrlAddr = proxyCtx.urlAddr.replace(
        encodedRawFileName,
        newFileName,
      );
      logger.debug(`[decrypt] retry with encoded name: ${encodedFilePath}`);
      fileInfo = storage.getFileInfo(encodedFilePath) as Record<
        string,
        unknown
      > | null;
      if (fileInfo) {
        filePath = encodedFilePath;
        proxyCtx.urlAddr = encodedUrlAddr;
      }
    }

    if (fileInfo) {
      fileSize = Number(fileInfo.size);
    }

    logger.debug(`[decrypt] fileSize from cache: ${fileSize}`);

    // fileSize 为 0 时，尝试 HEAD 请求获取文件大小
    if (fileSize === 0) {
      try {
        logger.debug(`[decrypt] HEAD request to: ${proxyCtx.urlAddr}`);
        const headResp = await fetch(proxyCtx.urlAddr, {
          method: "HEAD",
          headers: { host: new URL(proxyCtx.urlAddr).host },
          redirect: "follow",
        });
        const cl = headResp.headers.get("content-length");
        logger.debug(
          `[decrypt] HEAD response: ${headResp.status}, content-length: ${cl}`,
        );
        if (cl) fileSize = Number.parseInt(cl, 10);
      } catch (e) {
        logger.debug(`[decrypt] HEAD failed: ${e}`);
      }
    }

    logger.debug(
      `[decrypt] final fileSize: ${fileSize}, passwdInfo.enable: ${passwdInfo.enable}`,
    );

    if (fileSize === 0) {
      logger.debug(`[decrypt] fileSize=0, proxy without decryption`);
      try {
        return await httpProxy(proxyCtx.urlAddr, request, { removeHost: true });
      } finally {
        cleanupCtx(request);
      }
    }

    const flowEnc = new FlowEnc(
      passwdInfo.password,
      passwdInfo.encType,
      fileSize,
    );
    if (start) {
      await flowEnc.setPosition(start);
    }
    logger.info(
      `[decrypt] decrypting ${filePath} (size=${fileSize}, enc=${passwdInfo.encType})`,
    );
    try {
      return await httpProxy(proxyCtx.urlAddr, request, {
        decryptTransform: flowEnc.decryptTransform(),
        passwdInfo,
        fileSize,
        removeHost: true,
      });
    } finally {
      cleanupCtx(request);
    }
  }

  // 透传
  try {
    return await httpProxy(proxyCtx.urlAddr, request, { removeHost: true });
  } finally {
    cleanupCtx(request);
  }
}

async function handleFsGet(request: Request): Promise<Response> {
  const c = getCtx(request);
  if (!c) return new Response("no context", { status: 500 });
  const config = getConfig();

  const body = (await request.json()) as Record<string, unknown>;
  let filePath = body.path as string;
  logger.debug(`[fs-get] path=${filePath}, name=${body.name}`);

  // 检查 encMap：如果 UI 传了解密路径，需要转回加密路径给 alist
  const encMapPath = storage.get<string>(`encMap:${filePath}`);
  if (encMapPath) {
    logger.debug(`[fs-get] encMap hit: ${filePath} -> ${encMapPath}`);
    body.path = encMapPath;
    filePath = encMapPath;
  }

  // 用克隆的请求获取上游响应
  const upstreamReq = new Request(c.urlAddr, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  });
  const resp = await httpClient(c.urlAddr, upstreamReq, body);
  const result = JSON.parse(resp.body) as Record<string, unknown>;
  const { passwdInfo } = pathFindPasswd(
    config.alistServer.passwdList,
    filePath,
  );

  if (passwdInfo) {
    const data = result.data as Record<string, unknown> | undefined;
    if (data?.raw_url) {
      const key = crypto.randomUUID();
      // 提取加密文件名用于后续 Content-Disposition 解密
      const encFileName = path.basename(filePath);
      storage.cacheRedirect(key, {
        url: data.raw_url as string,
        passwdInfo,
        fileSize: (data.size as number) ?? 0,
        encFileName,
      });
      const proto = request.headers.get("x-forwarded-proto") ?? "http";
      data.raw_url = `${proto}://${c.selfHost}/redirect/${key}?decode=1&lastUrl=${encodeURIComponent(filePath)}&encName=${encodeURIComponent(encFileName)}`;
      if (data.provider === "AliyundriveOpen") {
        data.provider = "Local";
      }
    }
    // 缓存文件信息供后续下载请求使用
    // filePath 已经是完整路径如 /private/encrypt2/b.jpg
    if (data?.size) {
      storage.cacheFileInfo(filePath, {
        name: path.basename(filePath),
        size: data.size,
        path: filePath,
      });
      logger.debug(`[fs-get] cached file info: ${filePath} size=${data.size}`);
    } else {
      logger.debug(`[fs-get] skip cache: size=${data?.size}`);
    }
  }

  return Response.json(result);
}

async function handleFsList(request: Request): Promise<Response> {
  const c = getCtx(request);
  if (!c) return new Response("no context", { status: 500 });
  const config = getConfig();

  const body = (await request.json()) as Record<string, unknown>;
  const filePath = body.path as string;

  const upstreamReq = new Request(c.urlAddr, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  });
  const resp = await httpClient(c.urlAddr, upstreamReq, body);
  const result = JSON.parse(resp.body) as Record<string, unknown>;

  const data = result.data as Record<string, unknown> | undefined;
  if (data) {
    const content = data.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      // 查找匹配的 passwdInfo 用于文件名解密
      // 确保路径带尾部斜杠以匹配 glob 模式（如 /private/encrypt2/）
      const lookupPath = filePath.endsWith("/") ? filePath : `${filePath}/`;
      const { passwdInfo: listPasswdInfo } = pathFindPasswd(
        config.alistServer.passwdList,
        lookupPath,
      );

      for (const fileInfo of content) {
        const origName = fileInfo.name as string;
        fileInfo.path = `${filePath}/${origName}`;

        // 解密文件名：如果路径匹配加密且 encName 启用
        if (listPasswdInfo?.encName && origName) {
          const ext = origName.includes(".")
            ? origName.substring(origName.lastIndexOf("."))
            : "";
          const base = origName.replace(ext, "");
          const { decodeName } = await import("./utils/common.js");
          const decoded = decodeName(
            listPasswdInfo.password,
            listPasswdInfo.encType,
            base,
          );
          if (decoded) {
            // 缓存加密路径 -> 解密路径的映射，供 handleProxy 反向查找
            storage.set(
              `encMap:${filePath}/${decoded}`,
              `${filePath}/${origName}`,
              24 * 60 * 60 * 1000,
            );
            fileInfo.name = decoded;
            fileInfo.path = `${filePath}/${decoded}`;
            logger.debug(
              `[fs-list] name decrypt: "${origName}" -> "${decoded}"`,
            );
          }
        }

        storage.cacheFileInfo(fileInfo.path as string, fileInfo);
        logger.debug(
          `[fs-list] cached: ${fileInfo.path} size=${fileInfo.size}`,
        );
      }
    }
  }

  return Response.json(result);
}

async function handleFsPutBack(request: Request): Promise<Response> {
  const c = getCtx(request);
  if (!c) return new Response("no context", { status: 500 });

  const webdavConfig = c.webdavConfig;
  const contentLength = request.headers.get("content-length") || "0";
  const fileSize = Number.parseInt(contentLength, 10);

  const uploadPath = request.headers.get("file-path")
    ? decodeURIComponent(request.headers.get("file-path") ?? "")
    : "/-";

  const match = pathFindPasswd(webdavConfig.passwdList, uploadPath);
  const passwdInfo = "passwdInfo" in match ? match.passwdInfo : undefined;

  try {
    if (passwdInfo) {
      const flowEnc = new FlowEnc(
        passwdInfo.password,
        passwdInfo.encType,
        fileSize,
      );
      return await httpProxy(c.urlAddr, request, {
        encryptTransform: flowEnc.encryptTransform(),
        removeHost: true,
      });
    }
    return await httpProxy(c.urlAddr, request, { removeHost: true });
  } finally {
    cleanupCtx(request);
  }
}

// ==================== 启动 ====================

let currentServer: ReturnType<typeof Bun.serve> | null = null;

function logConfig(listenPort: number, appConfig: ServerConfig): void {
  const { alistServer } = appConfig;
  logger.info("========== Configuration ==========");
  logger.info(`  Listen Port:    ${listenPort}`);
  logger.info(`  File Logging:   ${appConfig.logFile === true ? "ON" : "OFF"}`);
  logger.info(
    `  Upstream:       ${alistServer.https ? "https" : "http"}://${alistServer.serverHost}:${alistServer.serverPort}`,
  );
  logger.info(`  Route Match:    ${alistServer.path}`);
  logger.info(`  Encryption:`);
  for (const p of alistServer.passwdList) {
    logger.info(
      `    - [${p.enable ? "ON" : "OFF"}] ${p.describe} (${p.encType}) encName=${p.encName}`,
    );
    logger.info(`      Paths: ${p.encPath.join(", ")}`);
  }
  if (appConfig.webdavServer.length > 0) {
    logger.info(`  WebDAV Servers: ${appConfig.webdavServer.length}`);
  }
  logger.info("====================================");
}

function buildFetchHandler(_appConfig: ServerConfig) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    logger.info(`[req] ${request.method} ${url.pathname}${url.search}`);

    // 每次请求动态获取路由，确保配置变更后立即生效
    const routes = buildRoutes();
    const appConfig = getConfig();

    for (const r of routes) {
      if (r.method !== "*" && r.method !== request.method) continue;
      const match = url.pathname.match(r.pattern);
      if (match) {
        if (!r.pattern.source.startsWith("^/redirect")) {
          preProxy(appConfig.alistServer, request, false);
        }
        try {
          return await r.handler(request, match);
        } catch (err) {
          logger.error("route error:", request.method, url.pathname, err);
          return Response.json(
            { code: 500, message: "Internal Server Error" },
            { status: 500 },
          );
        }
      }
    }

    logger.info(`[404] no route matched: ${url.pathname}`);
    return new Response("Not Found", { status: 404 });
  };
}

export async function startServer(port?: number): Promise<void> {
  const appConfig = loadConfig();
  initAlistConfig(appConfig.alistServer);

  for (const webdavConfig of appConfig.webdavServer) {
    if (webdavConfig.enable) {
      initAlistConfig(webdavConfig as Parameters<typeof initAlistConfig>[0]);
    }
  }

  setFileLog(appConfig.logFile === true);

  const listenPort = port ?? appConfig.port;
  logConfig(listenPort, appConfig);

  currentServer = Bun.serve({
    port: listenPort,
    fetch: buildFetchHandler(appConfig),
  });

  logger.info(
    `🚀 alist-encrypt proxy server started: http://localhost:${listenPort}`,
  );
  logger.info(`Config dir: ~/.config/alist-encrypt/`);
}

export function restartServer(): {
  success: boolean;
  port?: number;
  message?: string;
} {
  if (!currentServer) {
    return { success: false, message: "No server running" };
  }
  const oldPort = currentServer.port;
  currentServer.stop(true);
  currentServer = null;

  const appConfig = loadConfig();
  initAlistConfig(appConfig.alistServer);
  for (const webdavConfig of appConfig.webdavServer) {
    if (webdavConfig.enable) {
      initAlistConfig(webdavConfig as Parameters<typeof initAlistConfig>[0]);
    }
  }
  setFileLog(appConfig.logFile === true);

  const newPort = appConfig.port;
  logConfig(newPort, appConfig);

  currentServer = Bun.serve({
    port: newPort,
    fetch: buildFetchHandler(appConfig),
  });

  logger.info(
    `🔄 Server restarted: http://localhost:${newPort} (was ${oldPort})`,
  );

  return { success: true, port: newPort };
}

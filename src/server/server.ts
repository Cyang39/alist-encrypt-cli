import crypto from "node:crypto";
import path from "node:path";

import FlowEnc from "@/libs/flow-enc.js";
import { getConfig, initAlistConfig, loadConfig } from "./config.js";
import logger from "./logger.js";
import { httpClient, httpProxy } from "./proxy.js";
import * as storage from "./storage.js";
import type { PasswdInfo } from "./types.js";
import {
  encodeName,
  globToRegex,
  pathExec,
  pathFindPasswd,
} from "./utils/common.js";

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
const config = getConfig();

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

async function handleRedirect(
  request: Request,
  match: RegExpMatchArray,
): Promise<Response> {
  const key = match[1] ?? "";
  const data = storage.getRedirect(key) as {
    url: string;
    passwdInfo: PasswdInfo;
    fileSize: number;
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
  if (
    passwdInfo.enable &&
    (pathExec(passwdInfo.encPath, lastUrl) ||
      (passwdInfo.origEncPath && pathExec(passwdInfo.origEncPath, lastUrl)))
  ) {
    decryptTransform = flowEnc.decryptTransform();
  }
  if (decode) {
    decryptTransform = decode !== "0" ? flowEnc.decryptTransform() : null;
  }

  logger.debug(
    `[redirect] decrypt: ${decryptTransform ? "YES" : "NO"} (enable=${passwdInfo.enable}, pathExec=${pathExec(passwdInfo.encPath, lastUrl) || (passwdInfo.origEncPath && pathExec(passwdInfo.origEncPath, lastUrl)) ? "match" : "no-match"})`,
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

export async function startServer(port?: number): Promise<void> {
  const appConfig = loadConfig();
  initAlistConfig(appConfig.alistServer);

  for (const webdavConfig of appConfig.webdavServer) {
    if (webdavConfig.enable) {
      initAlistConfig(webdavConfig as Parameters<typeof initAlistConfig>[0]);
    }
  }

  const routes = buildRoutes();
  const listenPort = port ?? appConfig.port;

  // 调试：显示路由表
  for (const r of routes) {
    logger.info(`[route] ${r.method} ${r.pattern.source}`);
  }

  Bun.serve({
    port: listenPort,
    async fetch(request) {
      const url = new URL(request.url);
      logger.info(`[req] ${request.method} ${url.pathname}${url.search}`);

      // 匹配路由
      for (const r of routes) {
        if (r.method !== "*" && r.method !== request.method) continue;
        const match = url.pathname.match(r.pattern);
        if (match) {
          // preProxy 设置上下文（非重定向路由）
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
    },
  });

  logger.info(
    `🚀 alist-encrypt 代理服务器已启动: http://localhost:${listenPort}`,
  );
  logger.info(`📂 配置目录: ~/.config/alist-encrypt/`);
}

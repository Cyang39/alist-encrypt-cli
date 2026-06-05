import crypto from "node:crypto";
import path from "node:path";

import { getConfig, initAlistConfig, loadConfig } from "./config.js";
import { httpClient, httpProxy } from "./proxy.js";
import * as storage from "./storage.js";
import type { PasswdInfo } from "./types.js";
import {
  encodeName,
  globToRegex,
  pathExec,
  pathFindPasswd,
} from "./utils/common.js";
import FlowEnc from "./utils/flow-enc.js";

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

  const flowEnc = new FlowEnc(
    passwdInfo.password,
    passwdInfo.encType,
    fileSize,
  );
  if (start) {
    await flowEnc.setPosition(start);
  }

  const decode = requestUrl.searchParams.get("decode");
  const lastUrl = decodeURIComponent(
    requestUrl.searchParams.get("lastUrl") ?? "",
  );

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

  try {
    return await httpProxy(redirectUrl, proxyReq, {
      decryptTransform: decryptTransform ?? undefined,
      passwdInfo,
      fileSize,
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
      filePath = filePath.replace(encodedRawFileName, newFileName);
      proxyCtx.urlAddr = proxyCtx.urlAddr.replace(
        encodedRawFileName,
        newFileName,
      );
      fileInfo = storage.getFileInfo(filePath) as Record<
        string,
        unknown
      > | null;
    }

    if (fileInfo) {
      fileSize = Number(fileInfo.size);
    }

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
    if (start) {
      await flowEnc.setPosition(start);
    }
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
  const filePath = body.path as string;

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
      storage.cacheRedirect(key, {
        url: data.raw_url as string,
        passwdInfo,
        fileSize: (data.size as number) ?? 0,
      });
      const proto = request.headers.get("x-forwarded-proto") ?? "http";
      data.raw_url = `${proto}://${c.selfHost}/redirect/${key}?decode=1&lastUrl=${encodeURIComponent(filePath)}`;
      if (data.provider === "AliyundriveOpen") {
        data.provider = "Local";
      }
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
      for (const fileInfo of content) {
        fileInfo.path = `${filePath}/${fileInfo.name as string}`;
        storage.cacheFileInfo(fileInfo.path as string, fileInfo);
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
    console.log(`[route] ${r.method} ${r.pattern.source}`);
  }

  Bun.serve({
    port: listenPort,
    async fetch(request) {
      const url = new URL(request.url);
      console.log(`[req] ${request.method} ${url.pathname}${url.search}`);

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
            console.error("route error:", request.method, url.pathname, err);
            return Response.json(
              { code: 500, message: "Internal Server Error" },
              { status: 500 },
            );
          }
        }
      }

      console.log(`[404] no route matched: ${url.pathname}`);
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(
    `🚀 alist-encrypt 代理服务器已启动: http://localhost:${listenPort}`,
  );
  console.log(`📂 配置目录: ~/.config/alist-encrypt/`);
}

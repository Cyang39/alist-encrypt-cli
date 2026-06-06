import path from "node:path";
import { Hono } from "hono";
import FlowEnc from "@/libs/crypto/flow-enc.js";
import type { PasswdInfo } from "@/libs/types.js";
import { getConfig } from "../config.js";
import logger from "../logger.js";
import { httpProxy } from "../proxy.js";
import * as storage from "../storage.js";
import { encodeName, pathExec, pathFindPasswd } from "../utils/common.js";

// ProxyContext for upstream requests
interface ProxyContext {
  urlAddr: string;
  serverAddr: string;
  selfHost: string;
}

function buildProxyCtx(request: Request): ProxyContext {
  const config = getConfig();
  const { serverHost, serverPort, https } = config.alistServer;
  const url = new URL(request.url);
  const protocol = https ? "https" : "http";
  const host = `${serverHost}:${serverPort}`;
  return {
    urlAddr: `${protocol}://${host}${url.pathname}${url.search}`,
    serverAddr: `${protocol}://${host}`,
    selfHost: request.headers.get("host") ?? "",
  };
}

const app = new Hono();

// GET /redirect/:key — resolve cached redirect and proxy with decryption
app.get("/redirect/:key", async (c) => {
  const key = c.req.param("key");
  const data = storage.getRedirect(key) as {
    url: string;
    passwdInfo: PasswdInfo;
    fileSize: number;
    encFileName?: string;
  } | null;

  if (!data) {
    return c.text("not found", 404);
  }

  const { url: redirectUrl, passwdInfo, fileSize } = data;
  const requestUrl = new URL(c.req.url);
  const range = c.req.header("range");
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

  const flowEnc = new FlowEnc(
    passwdInfo.password,
    passwdInfo.encType,
    fileSize,
  );
  if (start) await flowEnc.setPosition(start);

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("referer");
  headers.delete("authorization");

  const proxyReq = new Request(redirectUrl, { method: c.req.method, headers });

  let decryptTransform = null;
  if (passwdInfo.enable && pathExec(passwdInfo.encPath, lastUrl)) {
    decryptTransform = flowEnc.decryptTransform();
  }
  if (decode) {
    decryptTransform = decode !== "0" ? flowEnc.decryptTransform() : null;
  }

  return httpProxy(redirectUrl, proxyReq, {
    decryptTransform: decryptTransform ?? undefined,
    passwdInfo,
    fileSize,
    encFileName,
    removeHost: true,
  });
});

// Generic proxy handler for /d/*, /p/*, /dav/*, and catch-all
app.all("*", async (c) => {
  const config = getConfig();
  const request = c.req.raw;
  const requestUrl = new URL(request.url);
  const proxyCtx = buildProxyCtx(request);

  const decodedUrl = decodeURIComponent(
    requestUrl.pathname + requestUrl.search,
  );
  const match = pathFindPasswd(config.alistServer.passwdList, decodedUrl);
  const passwdInfo = "passwdInfo" in match ? match.passwdInfo : undefined;

  logger.debug(
    `[proxy] ${request.method} ${decodedUrl} | passwdInfo: ${passwdInfo ? `${passwdInfo.encType}/${passwdInfo.enable}` : "null"}`,
  );

  // MOVE: rewrite Destination header
  if (request.method.toUpperCase() === "MOVE") {
    const destination = request.headers.get("destination");
    if (destination) {
      const destUrl = new URL(destination, request.url);
      const newDest = `${proxyCtx.serverAddr}${destUrl.pathname}${destUrl.search}`;
      const headers = new Headers(request.headers);
      headers.set("destination", newDest);
      return httpProxy(proxyCtx.urlAddr, new Request(request, { headers }), {
        removeHost: true,
      });
    }
  }

  // PUT with encryption
  if (request.method.toUpperCase() === "PUT" && passwdInfo) {
    const contentLength =
      request.headers.get("content-length") ||
      request.headers.get("x-expected-entity-length") ||
      "0";
    const fileSize = Number.parseInt(contentLength, 10);
    if (fileSize === 0) {
      return httpProxy(proxyCtx.urlAddr, request, { removeHost: true });
    }
    const flowEnc = new FlowEnc(
      passwdInfo.password,
      passwdInfo.encType,
      fileSize,
    );
    return httpProxy(proxyCtx.urlAddr, request, {
      encryptTransform: flowEnc.encryptTransform(),
      passwdInfo,
      fileSize,
      removeHost: true,
    });
  }

  // GET/HEAD/POST download with decryption
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

    // encMap reverse lookup
    if (!fileInfo) {
      const encMapPath = storage.get<string>(`encMap:${filePath}`);
      if (encMapPath) {
        fileInfo = storage.getFileInfo(encMapPath) as Record<
          string,
          unknown
        > | null;
        if (fileInfo) {
          filePath = encMapPath;
          proxyCtx.urlAddr = proxyCtx.urlAddr.replace(
            requestUrl.pathname,
            encMapPath,
          );
        }
      }
    }

    // Try encodeName
    if (!fileInfo) {
      const rawFileName = decodeURIComponent(path.basename(filePath));
      const ext = path.extname(rawFileName);
      const encFileName = encodeName(
        passwdInfo.password,
        passwdInfo.encType,
        rawFileName,
      );
      const newFileName = encFileName + ext;
      const encodedFilePath = filePath.replace(
        encodeURIComponent(rawFileName),
        newFileName,
      );
      fileInfo = storage.getFileInfo(encodedFilePath) as Record<
        string,
        unknown
      > | null;
      if (fileInfo) {
        filePath = encodedFilePath;
        proxyCtx.urlAddr = proxyCtx.urlAddr.replace(
          encodeURIComponent(rawFileName),
          newFileName,
        );
      }
    }

    if (fileInfo) fileSize = Number(fileInfo.size);

    // HEAD request fallback for file size
    if (fileSize === 0) {
      try {
        const headResp = await fetch(proxyCtx.urlAddr, {
          method: "HEAD",
          headers: { host: new URL(proxyCtx.urlAddr).host },
          redirect: "follow",
        });
        const cl = headResp.headers.get("content-length");
        if (cl) fileSize = Number.parseInt(cl, 10);
      } catch {
        // ignore
      }
    }

    if (fileSize === 0) {
      return httpProxy(proxyCtx.urlAddr, request, { removeHost: true });
    }

    const flowEnc = new FlowEnc(
      passwdInfo.password,
      passwdInfo.encType,
      fileSize,
    );
    logger.info(
      `[decrypt] ${filePath} (size=${fileSize}, enc=${passwdInfo.encType})`,
    );
    return httpProxy(proxyCtx.urlAddr, request, {
      decryptTransform: flowEnc.decryptTransform(),
      passwdInfo,
      fileSize,
      removeHost: true,
    });
  }

  // Passthrough
  return httpProxy(proxyCtx.urlAddr, request, { removeHost: true });
});

export default app;

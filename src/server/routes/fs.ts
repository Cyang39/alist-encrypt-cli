import crypto from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import FlowEnc from "@/libs/crypto/flow-enc.js";
import { getConfig } from "../config.js";
import logger from "../logger.js";
import { httpClient } from "../proxy.js";
import * as storage from "../storage.js";
import { decodeName, pathFindPasswd } from "../utils/common.js";

const app = new Hono();

// Helper: build proxy context from request
function buildProxyCtx(c: {
  req: { raw: Request; url: string; header: (k: string) => string | undefined };
}) {
  const config = getConfig();
  const { serverHost, serverPort, https } = config.alistServer;
  const url = new URL(c.req.url);
  const protocol = https ? "https" : "http";
  const host = `${serverHost}:${serverPort}`;
  return {
    urlAddr: `${protocol}://${host}${url.pathname}${url.search}`,
    serverAddr: `${protocol}://${host}`,
    selfHost: c.req.header("host") ?? "",
  };
}

// POST /api/fs/get
app.post("/api/fs/get", async (c) => {
  const ctx = buildProxyCtx(c);
  const config = getConfig();

  const body = await c.req.json<Record<string, unknown>>();
  let filePath = body.path as string;
  logger.debug(`[fs-get] path=${filePath}, name=${body.name}`);

  const encMapPath = storage.get<string>(`encMap:${filePath}`);
  if (encMapPath) {
    logger.debug(`[fs-get] encMap hit: ${filePath} -> ${encMapPath}`);
    body.path = encMapPath;
    filePath = encMapPath;
  }

  const upstreamReq = new Request(ctx.urlAddr, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: JSON.stringify(body),
  });
  const resp = await httpClient(ctx.urlAddr, upstreamReq, body);
  const result = JSON.parse(resp.body) as Record<string, unknown>;
  const { passwdInfo } = pathFindPasswd(
    config.alistServer.passwdList,
    filePath,
  );

  if (passwdInfo) {
    const data = result.data as Record<string, unknown> | undefined;
    if (data?.raw_url) {
      const key = crypto.randomUUID();
      const encFileName = path.basename(filePath);
      storage.cacheRedirect(key, {
        url: data.raw_url as string,
        passwdInfo,
        fileSize: (data.size as number) ?? 0,
        encFileName,
      });
      const proto = c.req.header("x-forwarded-proto") ?? "http";
      data.raw_url = `${proto}://${ctx.selfHost}/redirect/${key}?decode=1&lastUrl=${encodeURIComponent(filePath)}&encName=${encodeURIComponent(encFileName)}`;
      if (data.provider === "AliyundriveOpen") {
        data.provider = "Local";
      }
    }
    if (data?.size) {
      storage.cacheFileInfo(filePath, {
        name: path.basename(filePath),
        size: data.size,
        path: filePath,
      });
      logger.debug(`[fs-get] cached file info: ${filePath} size=${data.size}`);
    }
  }

  return c.json(result);
});

// POST /api/fs/list
app.post("/api/fs/list", async (c) => {
  const ctx = buildProxyCtx(c);
  const config = getConfig();

  const body = await c.req.json<Record<string, unknown>>();
  const filePath = body.path as string;

  const upstreamReq = new Request(ctx.urlAddr, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: JSON.stringify(body),
  });
  const resp = await httpClient(ctx.urlAddr, upstreamReq, body);
  const result = JSON.parse(resp.body) as Record<string, unknown>;

  const data = result.data as Record<string, unknown> | undefined;
  if (data) {
    const content = data.content as Array<Record<string, unknown>> | undefined;
    if (content) {
      const lookupPath = filePath.endsWith("/") ? filePath : `${filePath}/`;
      const { passwdInfo: listPasswdInfo } = pathFindPasswd(
        config.alistServer.passwdList,
        lookupPath,
      );

      for (const fileInfo of content) {
        const origName = fileInfo.name as string;
        fileInfo.path = `${filePath}/${origName}`;

        if (listPasswdInfo?.encName && origName) {
          const ext = origName.includes(".")
            ? origName.substring(origName.lastIndexOf("."))
            : "";
          const base = origName.replace(ext, "");
          const decoded = decodeName(
            listPasswdInfo.password,
            listPasswdInfo.encType,
            base,
          );
          if (decoded) {
            storage.set(
              `encMap:${filePath}/${decoded}`,
              `${filePath}/${origName}`,
              24 * 60 * 60 * 1000,
            );
            fileInfo.name = decoded;
            fileInfo.path = `${filePath}/${decoded}`;
          }
        }

        storage.cacheFileInfo(fileInfo.path as string, fileInfo);
      }
    }
  }

  return c.json(result);
});

// PUT /api/fs/put-back
app.put("/api/fs/put-back", async (c) => {
  const ctx = buildProxyCtx(c);
  const config = getConfig();

  const contentLength = c.req.header("content-length") || "0";
  const fileSize = Number.parseInt(contentLength, 10);

  const uploadPath = c.req.header("file-path")
    ? decodeURIComponent(c.req.header("file-path") ?? "")
    : "/-";

  const match = pathFindPasswd(config.alistServer.passwdList, uploadPath);
  const passwdInfo = "passwdInfo" in match ? match.passwdInfo : undefined;

  try {
    let resp: Response | { status: number; headers: Headers; body: string };
    if (passwdInfo) {
      const flowEnc = new FlowEnc(
        passwdInfo.password,
        passwdInfo.encType,
        fileSize,
      );
      const { httpProxy } = await import("../proxy.js");
      resp = await httpProxy(ctx.urlAddr, c.req.raw, {
        encryptTransform: flowEnc.encryptTransform(),
        removeHost: true,
      });
    } else {
      resp = await httpClient(ctx.urlAddr, c.req.raw);
    }
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (err) {
    logger.error("[fs-put-back] error:", err);
    return c.json({ code: 500, message: "Internal Server Error" }, 500);
  }
});

export default app;

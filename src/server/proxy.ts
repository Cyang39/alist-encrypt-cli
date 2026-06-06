import crypto from "node:crypto";
import type { Transform } from "node:stream";
import type { PasswdInfo } from "@/libs/types.js";
import logger from "./logger.js";
import * as storage from "./storage.js";

/**
 * 将 Node.js Transform stream 包装为 Web ReadableStream 管道
 */
function pipeThroughTransform(
  source: ReadableStream,
  transform: Transform,
): ReadableStream {
  return source.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        transform.write(chunk);
        let data = transform.read();
        while (data) {
          controller.enqueue(data);
          data = transform.read();
        }
      },
      flush(controller) {
        transform.end();
        let data = transform.read();
        while (data) {
          controller.enqueue(data);
          data = transform.read();
        }
      },
    }),
  );
}

/**
 * 核心代理函数：使用 Bun 原生 fetch 转发请求。
 * 对于无加密/解密的请求，直接 buffer body 后转发（最可靠）。
 * 对于需要加密/解密的请求，使用 TransformStream 流式处理。
 */
export async function httpProxy(
  urlAddr: string,
  request: Request,
  options: {
    encryptTransform?: Transform;
    decryptTransform?: Transform;
    passwdInfo?: PasswdInfo;
    fileSize?: number;
    encFileName?: string;
    removeHost?: boolean;
  } = {},
): Promise<Response> {
  const {
    encryptTransform,
    decryptTransform,
    encFileName: encFileNameOpt,
    passwdInfo,
    fileSize,
    removeHost,
  } = options;

  // 构建上游请求头
  const headers = new Headers(request.headers);
  const url = new URL(urlAddr);
  if (removeHost) headers.delete("host");
  else headers.set("host", url.host);

  // 读取并可能加密请求体
  let upstreamBody: ArrayBuffer | ReadableStream | null = null;
  if (request.body) {
    if (encryptTransform) {
      // 流式加密：保持 ReadableStream
      upstreamBody = pipeThroughTransform(request.body, encryptTransform);
    } else {
      // 直接 buffer，避免 ReadableStream 兼容问题
      const buf = await request.arrayBuffer();
      upstreamBody = buf.byteLength > 0 ? buf : null;
    }
  }

  // 发起上游请求（手动处理重定向）
  const upstream = await fetch(urlAddr, {
    method: request.method,
    headers,
    body: upstreamBody,
    redirect: "manual",
  });

  logger.info(`[proxy] ${request.method} ${urlAddr} -> ${upstream.status}`);

  // 处理 3xx 重定向：缓存并改写为本地 /redirect/:key
  if (upstream.status >= 300 && upstream.status < 305) {
    const redirectUrl = upstream.headers.get("location") || "-";
    logger.debug(
      `[proxy] redirect ${upstream.status} -> ${redirectUrl} (decrypt=${!!decryptTransform}, enable=${passwdInfo?.enable})`,
    );
    if (decryptTransform && passwdInfo?.enable) {
      const key = crypto.randomUUID();
      storage.cacheRedirect(key, {
        url: redirectUrl,
        passwdInfo,
        fileSize: fileSize ?? 0,
      });
      const reqUrl = new URL(request.url);
      const lastUrl = encodeURIComponent(reqUrl.pathname + reqUrl.search);
      const respHeaders = new Headers(upstream.headers);
      respHeaders.set(
        "location",
        `/redirect/${key}?decode=1&lastUrl=${lastUrl}`,
      );
      return new Response(null, {
        status: upstream.status,
        headers: respHeaders,
      });
    }
    // 不需要解密的重定向，直接返回
    return new Response(null, {
      status: upstream.status,
      headers: upstream.headers,
    });
  }

  // 处理 content-range + 200 的情况
  let statusCode = upstream.status;
  if (upstream.headers.get("content-range") && statusCode === 200) {
    statusCode = 206;
  }

  // 构建响应头
  const respHeaders = new Headers(upstream.headers);

  // 解密文件名
  if (
    request.method === "GET" &&
    (statusCode === 200 || statusCode === 206) &&
    passwdInfo?.enable &&
    passwdInfo.encName
  ) {
    // 优先使用传递的加密文件名（redirect 链路），否则从请求 URL 提取
    const fileName =
      encFileNameOpt ||
      decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
    const ext = fileName.includes(".")
      ? fileName.substring(fileName.lastIndexOf("."))
      : "";
    const base = fileName.replace(ext, "");
    const { decodeName } = await import("./utils/common.js");
    const decoded = decodeName(passwdInfo.password, passwdInfo.encType, base);
    logger.debug(
      `[proxy] filename decrypt: "${fileName}" -> "${decoded ?? "FAILED"}"`,
    );
    if (decoded) {
      let cd = respHeaders.get("content-disposition") ?? "";
      logger.debug(`[proxy] original cd: "${cd}"`);
      cd = cd.replace(/filename\*?=[^=;]*;?/g, "").trim();
      const newCd = cd
        ? `${cd}; filename*=UTF-8''${encodeURIComponent(decoded)}`
        : `attachment; filename*=UTF-8''${encodeURIComponent(decoded)}`;
      respHeaders.set("content-disposition", newCd);
      logger.debug(`[proxy] new cd: "${newCd}"`);
    }
  }

  // 构建响应体
  let responseBody: ReadableStream | null = null;
  if (decryptTransform && upstream.body) {
    // 流式解密
    logger.debug(
      `[proxy] decrypting response body (${upstream.headers.get("content-length") ?? "unknown"} bytes)`,
    );
    responseBody = pipeThroughTransform(upstream.body, decryptTransform);
  } else if (upstream.body) {
    // 直接透传
    responseBody = upstream.body;
  }

  return new Response(responseBody, {
    status: statusCode,
    headers: respHeaders,
  });
}

/**
 * 简单 HTTP 客户端：收集完整响应体，用于 API 调用。
 */
export async function httpClient(
  urlAddr: string,
  request: Request,
  reqBody?: string | object,
): Promise<{ status: number; headers: Headers; body: string }> {
  const headers = new Headers(request.headers);
  headers.delete("host");

  const url = new URL(urlAddr);
  headers.set("host", url.host);

  let body: string | undefined;
  if (reqBody) {
    body = typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody);
  } else if (request.body) {
    body = await request.text();
  }

  const upstream = await fetch(urlAddr, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });

  const respBody = await upstream.text();
  return {
    status: upstream.status,
    headers: upstream.headers,
    body: respBody,
  };
}

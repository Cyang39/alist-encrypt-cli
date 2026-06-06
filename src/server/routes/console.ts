import jwt from "@tsndr/cloudflare-worker-jwt";
import { Hono } from "hono";
import type { ServerConfig } from "@/libs/types.js";
import { getConfig, initAlistConfig, saveConfig } from "../config.js";
import logger from "../logger.js";
import { verifyToken } from "../middleware/auth.js";

// Web UI HTML
let consoleHtmlBody: string;
try {
  const mod = await import("../../../dist/index.html", {
    with: { type: "text" },
  });
  consoleHtmlBody = mod.default as unknown as string;
} catch {
  consoleHtmlBody = "<h1>Web UI not built. Run: bun run build</h1>";
}

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match?.[1] || !match?.[2]) return 7 * 24 * 60 * 60;
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

const app = new Hono();

// Web UI
app.get("/@console", (c) => {
  return c.html(consoleHtmlBody);
});

// Login (no auth required)
app.post("/@console/api/login", async (c) => {
  try {
    const body = await c.req.json<{ password?: string }>();
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
      return c.json({ success: true, token });
    }
    return c.json({ success: false, message: "Invalid password" }, 401);
  } catch {
    return c.json({ success: false, message: "Invalid request" }, 400);
  }
});

// Lang (GET no auth, POST requires auth)
app.get("/@console/api/lang", (c) => {
  const config = getConfig();
  return c.json({ success: true, lang: config.web?.lang ?? "en" });
});

app.post("/@console/api/lang", verifyToken, async (c) => {
  try {
    const body = await c.req.json<{ lang?: string }>();
    if (!body.lang) {
      return c.json({ success: false, message: "Missing lang" }, 400);
    }
    const config = getConfig();
    config.web = { ...config.web, lang: body.lang };
    saveConfig(config);
    logger.info(`[lang] Language saved: ${body.lang}`);
    return c.json({ success: true });
  } catch {
    return c.json({ success: false, message: "Invalid request" }, 400);
  }
});

// CWD (no auth required)
app.get("/@console/api/cwd", (c) => {
  return c.json({ success: true, cwd: process.cwd() });
});

// Settings (auth required)
app.get("/@console/api/settings", verifyToken, (c) => {
  const config = getConfig();
  const safeConfig = structuredClone(config);
  for (const p of safeConfig.alistServer.passwdList) {
    p.password = "******";
  }
  for (const w of safeConfig.webdavServer) {
    for (const p of w.passwdList) {
      p.password = "******";
    }
  }
  return c.json({ success: true, config: safeConfig });
});

app.post("/@console/api/settings", verifyToken, async (c) => {
  try {
    const body = await c.req.json<{ config?: ServerConfig }>();
    if (!body.config) {
      return c.json({ success: false, message: "Missing config" }, 400);
    }
    const newConfig = body.config;
    if (
      !newConfig.alistServer?.serverHost ||
      !newConfig.alistServer?.passwdList
    ) {
      return c.json(
        { success: false, message: "Invalid config: missing alistServer" },
        400,
      );
    }
    // Restore masked passwords
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
    return c.json({ success: true });
  } catch {
    return c.json({ success: false, message: "Invalid request body" }, 400);
  }
});

// Restart (auth required)
app.post("/@console/api/restart", verifyToken, async (c) => {
  try {
    const { restartServer } = await import("../index.js");
    const result = restartServer();
    return c.json(result);
  } catch (err) {
    logger.error("[restart] Failed:", err);
    return c.json({ success: false, message: "Restart failed" }, 500);
  }
});

// Encrypt (auth required, SSE)
app.post("/@console/api/encrypt", verifyToken, async (c) => {
  // Import encrypt handler lazily to avoid circular deps
  const { handleEncrypt } = await import("./encrypt.js");
  return handleEncrypt(c);
});

export default app;

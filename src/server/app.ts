import { Hono } from "hono";
import logger from "./logger.js";
import consoleRoutes from "./routes/console.js";
import fsRoutes from "./routes/fs.js";
import proxyRoutes from "./routes/proxy.js";

export function createApp(): Hono {
  const app = new Hono();

  // Request logging middleware
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    logger.info(`[req] ${c.req.method} ${url.pathname}${url.search}`);
    await next();
  });

  // Mount route groups (order matters — more specific first)
  app.route("/", consoleRoutes);
  app.route("/", fsRoutes);
  app.route("/", proxyRoutes);

  // 404 fallback
  app.notFound((c) => {
    const url = new URL(c.req.url);
    logger.info(`[404] no route matched: ${url.pathname}`);
    return c.text("Not Found", 404);
  });

  // Error handler
  app.onError((err, c) => {
    const url = new URL(c.req.url);
    logger.error("route error:", c.req.method, url.pathname, err);
    return c.json({ code: 500, message: "Internal Server Error" }, 500);
  });

  return app;
}

import jwt from "@tsndr/cloudflare-worker-jwt";
import type { Context, Next } from "hono";
import { getConfig } from "../config.js";

export async function verifyToken(
  c: Context,
  next: Next,
): Promise<Response | undefined> {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }
  const token = authHeader.slice(7);
  const config = getConfig();
  const jwtSecret = config.jwtSecret ?? "alist-encrypt-secret";
  const valid = !!(await jwt.verify(token, jwtSecret));
  if (!valid) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }
  await next();
}

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR = join(homedir(), ".config", "alist-encrypt", "logs");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogPath(): string {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return join(LOG_DIR, `${date}.log`);
}

function timestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
}

function writeLog(level: string, args: unknown[]): void {
  ensureLogDir();
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  const line = `${timestamp()} [${level}] ${msg}\n`;
  try {
    appendFileSync(getLogPath(), line, "utf-8");
  } catch {
    // 写日志失败不影响主流程
  }
}

export const logger = {
  debug(...args: unknown[]): void {
    console.log(...args);
    writeLog("DEBUG", args);
  },
  info(...args: unknown[]): void {
    console.log(...args);
    writeLog("INFO", args);
  },
  warn(...args: unknown[]): void {
    console.warn(...args);
    writeLog("WARN", args);
  },
  error(...args: unknown[]): void {
    console.error(...args);
    writeLog("ERROR", args);
  },
};

export default logger;

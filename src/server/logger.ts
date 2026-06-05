import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// 优先在执行目录下找 config 文件夹，否则使用 ~/.config/alist-encrypt
const LOCAL_CONFIG_DIR = join(process.cwd(), "config");
const HOME_CONFIG_DIR = join(homedir(), ".config", "alist-encrypt");
const CONFIG_DIR = existsSync(LOCAL_CONFIG_DIR)
  ? LOCAL_CONFIG_DIR
  : HOME_CONFIG_DIR;
const LOG_DIR = join(CONFIG_DIR, "logs");

let fileLogEnabled = false;

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
  if (!fileLogEnabled) return;
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

/**
 * 设置是否启用文件日志
 */
export function setFileLog(enabled: boolean): void {
  fileLogEnabled = enabled;
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

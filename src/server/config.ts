import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ServerConfig } from "./types.js";

const CONFIG_DIR = join(homedir(), ".config", "alist-encrypt");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: ServerConfig = {
  port: 5344,
  alistServer: {
    name: "alist",
    path: "/*",
    describe: "alist server",
    serverHost: "192.168.1.100",
    serverPort: 5244,
    https: false,
    passwdList: [
      {
        password: "123456",
        describe: "default",
        encType: "aesctr",
        enable: true,
        encName: false,
        encSuffix: "",
        encPath: ["encrypt_folder/*"],
      },
    ],
  },
  webdavServer: [],
};

let cachedConfig: ServerConfig | null = null;

export function loadConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    cachedConfig = structuredClone(DEFAULT_CONFIG);
    console.log(`📝 已创建默认配置: ${CONFIG_FILE}`);
    return cachedConfig;
  }

  const raw = readFileSync(CONFIG_FILE, "utf-8");
  cachedConfig = JSON.parse(raw) as ServerConfig;
  return cachedConfig;
}

export function saveConfig(config: ServerConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  cachedConfig = config;
}

export function getConfig(): ServerConfig {
  if (!cachedConfig) return loadConfig();
  return cachedConfig;
}

/**
 * 展开 encPath：为每个路径加上 /d、/p、/dav 前缀，
 * 以便后续路由匹配。
 */
export function initAlistConfig(
  alistServer: ServerConfig["alistServer"],
): void {
  for (const passwdInfo of alistServer.passwdList) {
    const expanded: string[] = [];
    for (const p of passwdInfo.encPath) {
      // 如果已经有前缀则跳过
      if (p.startsWith("/d/") || p.startsWith("/p/") || p.startsWith("/dav/")) {
        expanded.push(p);
        continue;
      }
      expanded.push(`/d${p.startsWith("/") ? "" : "/"}${p}`);
      expanded.push(`/p${p.startsWith("/") ? "" : "/"}${p}`);
      expanded.push(`/dav${p.startsWith("/") ? "" : "/"}${p}`);
    }
    passwdInfo.encPath = expanded;
  }
}

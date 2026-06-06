import type { IncomingMessage, ServerResponse } from "node:http";

export type EncType = "aesctr" | "rc4" | "mix";

export interface PasswdInfo {
  password: string;
  describe: string;
  encType: EncType;
  enable: boolean;
  encName: boolean;
  encSuffix: string;
  encPath: string[];
}

export interface ServerConfig {
  port: number;
  /** 是否记录日志文件（默认关闭） */
  logFile?: boolean;
  /** 控制台登录密码（默认 123456） */
  password?: string;
  /** JWT 签名密钥（默认 alist-encrypt-secret） */
  jwtSecret?: string;
  /** JWT 过期时间，如 "7d"、"24h"、"60m"（默认 7d） */
  jwtExpiresIn?: string;
  /** Web UI 配置 */
  web?: {
    /** 界面语言（默认 en） */
    lang?: string;
  };
  alistServer: {
    name: string;
    path: string;
    describe: string;
    serverHost: string;
    serverPort: number;
    https: boolean;
    passwdList: PasswdInfo[];
  };
  webdavServer: WebdavConfig[];
}

export interface WebdavConfig {
  id: string;
  name: string;
  path: string;
  describe: string;
  enable: boolean;
  serverHost: string;
  serverPort: number;
  https: boolean;
  passwdList: PasswdInfo[];
}

export interface RedirectData {
  url: string;
  passwdInfo: PasswdInfo;
  fileSize: number;
  encFileName?: string;
}

/** Hono Context 中 env 的类型 */
export interface ProxyEnv {
  incoming: IncomingMessage & ProxyRequest;
  outgoing: ServerResponse;
}

/** 附加到 Node.js IncomingMessage 上的代理属性 */
export interface ProxyRequest {
  selfHost?: string;
  origin?: string;
  urlAddr?: string;
  serverAddr?: string;
  webdavConfig?:
    | (ServerConfig["alistServer"] & { passwdList: PasswdInfo[] })
    | WebdavConfig;
  isWebdav?: boolean;
  fileSize?: number;
}

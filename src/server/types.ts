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

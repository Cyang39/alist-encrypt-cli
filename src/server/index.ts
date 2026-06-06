import type { ServerConfig } from "@/libs/types.js";
import { createApp } from "./app.js";
import { initAlistConfig, loadConfig } from "./config.js";
import logger, { setFileLog } from "./logger.js";

let currentServer: ReturnType<typeof Bun.serve> | null = null;

function logConfig(listenPort: number, appConfig: ServerConfig): void {
  const { alistServer } = appConfig;
  logger.info("========== Configuration ==========");
  logger.info(`  Listen Port:    ${listenPort}`);
  logger.info(`  File Logging:   ${appConfig.logFile === true ? "ON" : "OFF"}`);
  logger.info(
    `  Upstream:       ${alistServer.https ? "https" : "http"}://${alistServer.serverHost}:${alistServer.serverPort}`,
  );
  logger.info(`  Route Match:    ${alistServer.path}`);
  logger.info(`  Encryption:`);
  for (const p of alistServer.passwdList) {
    logger.info(
      `    - [${p.enable ? "ON" : "OFF"}] ${p.describe} (${p.encType}) encName=${p.encName}`,
    );
    logger.info(`      Paths: ${p.encPath.join(", ")}`);
  }
  if (appConfig.webdavServer.length > 0) {
    logger.info(`  WebDAV Servers: ${appConfig.webdavServer.length}`);
  }
  logger.info("====================================");
}

export async function startServer(port?: number): Promise<void> {
  const appConfig = loadConfig();
  initAlistConfig(appConfig.alistServer);

  for (const webdavConfig of appConfig.webdavServer) {
    if (webdavConfig.enable) {
      initAlistConfig(webdavConfig as Parameters<typeof initAlistConfig>[0]);
    }
  }

  setFileLog(appConfig.logFile === true);

  const listenPort = port ?? appConfig.port;
  logConfig(listenPort, appConfig);

  const app = createApp();
  currentServer = Bun.serve({
    port: listenPort,
    fetch: app.fetch,
  });

  logger.info(
    `🚀 alist-encrypt proxy server started: http://localhost:${listenPort}`,
  );
  logger.info(`Config dir: ~/.config/alist-encrypt/`);
}

export function restartServer(): {
  success: boolean;
  port?: number;
  message?: string;
} {
  if (!currentServer) {
    return { success: false, message: "No server running" };
  }
  const oldPort = currentServer.port;
  currentServer.stop(true);
  currentServer = null;

  const appConfig = loadConfig();
  initAlistConfig(appConfig.alistServer);
  for (const webdavConfig of appConfig.webdavServer) {
    if (webdavConfig.enable) {
      initAlistConfig(webdavConfig as Parameters<typeof initAlistConfig>[0]);
    }
  }
  setFileLog(appConfig.logFile === true);

  const newPort = appConfig.port;
  logConfig(newPort, appConfig);

  const app = createApp();
  currentServer = Bun.serve({
    port: newPort,
    fetch: app.fetch,
  });

  logger.info(
    `🔄 Server restarted: http://localhost:${newPort} (was ${oldPort})`,
  );

  return { success: true, port: newPort };
}

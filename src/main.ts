import { parseArgs } from "node:util";

const HELP = `Usage: alist-encrypt [command] [options]

Commands:
  (default)            Start alist proxy server
  encrypt <input> [-p <password>] [-o <output>] [-e <algorithm>]
                       Encrypt a local file (uses web console config as defaults)
  server               Start alist proxy server

  Drag & drop:         Drag a file onto the exe to encrypt it
                       Uses config defaults (password, algorithm, encName)

Options:
  -h, --help           Show help
  -p, --password       Password for encryption (falls back to config)
  -o, --output         Output file path (falls back to config outputDir)
  -e, --encrypt-type   Encryption algorithm: aesctr (default), rc4, mix (falls back to config)
  --port               Server listen port

Examples:
  alist-encrypt
  alist-encrypt server --port 8080
  alist-encrypt encrypt ./video.mp4 -p mypassword -o ./video.enc
  alist-encrypt encrypt ./video.mp4 -p mypassword -o ./video.enc -e rc4
  alist-encrypt encrypt ./video.mp4  (uses config defaults)`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    password: { type: "string", short: "p" },
    output: { type: "string", short: "o" },
    port: { type: "string" },
    "encrypt-type": { type: "string", short: "e" },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

// 无参数时默认启动 server
const command = positionals[0] ?? "server";

// 拖拽文件到 exe 上：第一个参数是文件路径且文件存在
if (
  command !== "encrypt" &&
  command !== "server" &&
  command !== "--help" &&
  command !== "-h"
) {
  const { accessSync } = await import("node:fs");
  try {
    accessSync(command);
    // 文件存在，作为拖拽加密处理
    const inputPath = command;
    const { getConfig } = await import("./server/config.js");
    const config = getConfig();
    const enc = config.encrypt;

    const password = values.password ?? enc?.password;
    const encType = values["encrypt-type"] ?? enc?.encType ?? "aesctr";

    if (!password) {
      console.error(
        "Error: password required (use -p or set it in the web console)",
      );
      process.exit(1);
    }

    const path = await import("node:path");
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    const dir = path.dirname(inputPath);

    let outputPath: string;
    if (values.output) {
      outputPath = values.output;
    } else if (enc?.encName) {
      // 加密文件名：encodeName 需要密码和算法
      const { encodeName } = await import("./server/utils/common.js");
      const encName = encodeName(password, encType, base);
      outputPath = path.join(dir, encName + ext);
    } else {
      // 不加密文件名：加 .encrypt 后缀
      outputPath = path.join(dir, `${base}.encrypt${ext}`);
    }

    const { runEncrypt } = await import("./encrypt.js");
    try {
      await runEncrypt(inputPath, password, outputPath, encType);
    } catch (err) {
      console.error("Error:", err);
    }
    console.log("\nPress any key to exit...");
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => {
        process.stdin.setRawMode?.(false);
        resolve();
      });
    });
    process.exit(0);
  } catch {
    // 文件不存在，当作未知命令处理
  }
}

if (command === "encrypt") {
  const inputPath = positionals[1];
  if (!inputPath) {
    console.error(
      "Usage: alist-encrypt encrypt <input> [-p <password>] [-o <output>] [-e <algorithm>]",
    );
    process.exit(1);
  }

  // Load config for defaults
  const { getConfig } = await import("./server/config.js");
  const config = getConfig();
  const enc = config.encrypt;

  const password = values.password ?? enc?.password;
  const encType = values["encrypt-type"] ?? enc?.encType ?? "aesctr";
  let outputPath = values.output;

  if (!password) {
    console.error(
      "Error: password required (use -p or set it in the web console)",
    );
    process.exit(1);
  }

  // Default output: input file + .enc extension, or use config outputDir
  if (!outputPath) {
    if (enc?.outputDir) {
      const path = await import("node:path");
      const fileName = path.basename(inputPath);
      outputPath = path.join(enc.outputDir, fileName);
    } else {
      outputPath = `${inputPath}.enc`;
    }
  }

  const { runEncrypt } = await import("./encrypt.js");
  try {
    await runEncrypt(inputPath, password, outputPath, encType);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
} else if (command === "server") {
  const { startServer } = await import("./server/index.js");
  try {
    await startServer(
      values.port ? Number.parseInt(values.port, 10) : undefined,
    );
  } catch (err) {
    console.error("Server startup failed:", err);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.log(HELP);
  process.exit(1);
}

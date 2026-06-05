import { parseArgs } from "node:util";

const HELP = `用法: alist-encrypt <command> [options]

命令:
  encrypt <input> -p <password> -o <output>
                       加密本地文件
  server               启动 alist 代理服务器

选项:
  -h, --help           显示帮助信息

示例:
  alist-encrypt encrypt ./video.mp4 -p mypassword -o ./video.enc
  alist-encrypt server
  alist-encrypt server --port 8080`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    password: { type: "string", short: "p" },
    output: { type: "string", short: "o" },
    port: { type: "string" },
  },
  strict: true,
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const command = positionals[0];

if (command === "encrypt") {
  const inputPath = positionals[1];
  const password = values.password;
  const outputPath = values.output;

  if (!inputPath || !password || !outputPath) {
    console.error(
      "用法: alist-encrypt encrypt <input> -p <password> -o <output>",
    );
    process.exit(1);
  }

  const { runEncrypt } = await import("./encrypt.js");
  try {
    await runEncrypt(inputPath, password, outputPath);
  } catch (err) {
    console.error("❌ 出错了:", err);
    process.exit(1);
  }
} else if (command === "server") {
  const { startServer } = await import("./server/server.js");
  try {
    await startServer(
      values.port ? Number.parseInt(values.port, 10) : undefined,
    );
  } catch (err) {
    console.error("❌ 服务器启动失败:", err);
    process.exit(1);
  }
} else {
  console.error(`未知命令: ${command}`);
  console.log(HELP);
  process.exit(1);
}

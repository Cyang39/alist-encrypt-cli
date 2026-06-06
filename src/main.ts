import { parseArgs } from "node:util";

const HELP = `Usage: alist-encrypt [command] [options]

Commands:
  (default)            Start alist proxy server
  encrypt <input> -p <password> -o <output> [-e <algorithm>]
                       Encrypt a local file
  server               Start alist proxy server

Options:
  -h, --help           Show help
  -p, --password       Password for encryption
  -o, --output         Output file path
  -e, --encrypt-type   Encryption algorithm: aesctr (default), rc4, mix
  --port               Server listen port

Examples:
  alist-encrypt
  alist-encrypt server --port 8080
  alist-encrypt encrypt ./video.mp4 -p mypassword -o ./video.enc
  alist-encrypt encrypt ./video.mp4 -p mypassword -o ./video.enc -e rc4`;

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

if (command === "encrypt") {
  const inputPath = positionals[1];
  const password = values.password;
  const outputPath = values.output;
  const encType = values["encrypt-type"] ?? "aesctr";

  if (!inputPath || !password || !outputPath) {
    console.error(
      "Usage: alist-encrypt encrypt <input> -p <password> -o <output> [-e <algorithm>]",
    );
    process.exit(1);
  }

  const { runEncrypt } = await import("./encrypt.js");
  try {
    await runEncrypt(inputPath, password, outputPath, encType);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
} else if (command === "server") {
  const { startServer } = await import("./server/server.js");
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

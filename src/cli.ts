import { parseArgs } from "node:util";

const HELP = `Usage: alist-encrypt <command> [options]

Commands:
  encrypt <input> -p <password> -o <output>
                       Encrypt a local file
  server               Start alist proxy server

Options:
  -h, --help           Show help

Examples:
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
      "Usage: alist-encrypt encrypt <input> -p <password> -o <output>",
    );
    process.exit(1);
  }

  const { runEncrypt } = await import("./encrypt.js");
  try {
    await runEncrypt(inputPath, password, outputPath);
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

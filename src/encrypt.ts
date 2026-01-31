import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "util";
import AesCTR from "./aesCTR";

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    password: { type: "string", short: "p" },
    output: { type: "string", short: "o" },
  },
  strict: false,
});

const inputPath = positionals[2];
const password = values.password;
const outputPath = values.output;

if (!inputPath || !password || !outputPath) {
  console.error("用法: bun encrypt.ts <input> --password <pw> --output <output>");
  process.exit(1);
}

async function run() {
  try {
    const fileStats = await stat(inputPath as string);
    const sizeSalt = fileStats.size;
    const aes = new AesCTR(password, sizeSalt);

    const input = createReadStream(inputPath as string);
    const output = createWriteStream(outputPath as string);

    console.log(`🚀 开始加密...`);

    await pipeline(
      input,
      aes.encryptTransform(),
      output
    );

    console.log(`✅ 加密成功: ${outputPath}`);
  } catch (err) {
    console.error("❌ 出错了:", err);
  }
}

run();

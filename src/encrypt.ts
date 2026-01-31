import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "util";

const AesCTR = (await import("./aesCTR")).default;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    password: { type: "string", short: "p" },
    output: { type: "string", short: "o" },
  },
  strict: true,
  allowPositionals: true,
});

const inputPath = positionals[0];
const password = values.password;
const outputPath = values.output;

if (!inputPath || !password || !outputPath) {
  console.error("用法: encrypt <input> -p <password> -o <output>");
  console.error("或: encrypt <input> --password <pw> --output <output>");
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
    console.log(`输入文件: ${inputPath}`);
    console.log(`输出文件: ${outputPath}`);

    await pipeline(
      input,
      aes.encryptTransform(),
      output
    );

    console.log(`✅ 加密成功: ${outputPath}`);
  } catch (err) {
    console.error("❌ 出错了:", err);
    process.exit(1);
  }
}

run();
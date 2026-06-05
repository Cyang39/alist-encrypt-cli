import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import AesCTR from "./aesCTR.js";

export async function runEncrypt(
  inputPath: string,
  password: string,
  outputPath: string,
): Promise<void> {
  const fileStats = await stat(inputPath);
  const sizeSalt = fileStats.size;
  const aes = new AesCTR(password, sizeSalt);

  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  console.log(`🚀 开始加密...`);
  console.log(`输入文件: ${inputPath}`);
  console.log(`输出文件: ${outputPath}`);

  await pipeline(input, aes.encryptTransform(), output);

  console.log(`✅ 加密成功: ${outputPath}`);
}

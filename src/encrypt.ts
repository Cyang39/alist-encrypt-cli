import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import FlowEnc from "@/libs/crypto/flow-enc.js";
import type { EncType } from "@/libs/types.js";

export async function runEncrypt(
  inputPath: string,
  password: string,
  outputPath: string,
  encType: string = "aesctr",
): Promise<void> {
  const fileStats = await stat(inputPath);
  const sizeSalt = fileStats.size;
  const flowEnc = new FlowEnc(password, encType as EncType, sizeSalt);

  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  console.log(`Encrypting (${encType})...`);
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);

  await pipeline(input, flowEnc.encryptTransform(), output);

  console.log(`Done: ${outputPath}`);
}

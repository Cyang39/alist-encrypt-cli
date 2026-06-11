import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";

import FlowEnc from "@/libs/crypto/flow-enc.js";
import type { EncType } from "@/libs/types.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function printProgress(bytesProcessed: number, fileSize: number): void {
  const pct = fileSize > 0 ? Math.round((bytesProcessed / fileSize) * 100) : 0;
  const bar =
    "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  process.stdout.write(
    `\r  [${bar}] ${pct}%  ${formatBytes(bytesProcessed)} / ${formatBytes(fileSize)}`,
  );
}

export async function runEncrypt(
  inputPath: string,
  password: string,
  outputPath: string,
  encType: string = "aesctr",
): Promise<void> {
  const fileStats = await stat(inputPath);
  const fileSize = fileStats.size;
  const flowEnc = new FlowEnc(password, encType as EncType, fileSize);

  const input = createReadStream(inputPath);
  const output = createWriteStream(outputPath);

  console.log(`Encrypting (${encType})...`);
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Size:   ${formatBytes(fileSize)}`);

  let bytesProcessed = 0;
  const progressStream = new PassThrough();
  progressStream.on("data", (chunk: Buffer) => {
    bytesProcessed += chunk.length;
    printProgress(bytesProcessed, fileSize);
  });
  progressStream.on("end", () => {
    printProgress(fileSize, fileSize);
    process.stdout.write("\n");
  });

  await pipeline(input, flowEnc.encryptTransform(), progressStream, output);

  console.log(`Done: ${outputPath}`);
}

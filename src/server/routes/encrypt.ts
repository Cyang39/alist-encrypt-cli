import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Context } from "hono";
import FlowEnc from "@/libs/crypto/flow-enc.js";
import type { EncType } from "@/libs/types.js";
import { decodeName, encodeName } from "../utils/common.js";

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function handleEncrypt(c: Context): Promise<Response> {
  const body = await c.req.json<{
    inputDir?: string;
    outputDir?: string;
    password?: string;
    encType?: string;
    encName?: boolean;
    mode?: string;
  }>();

  if (!body.inputDir || !body.outputDir || !body.password) {
    return c.json(
      { success: false, message: "Missing inputDir, outputDir, or password" },
      400,
    );
  }

  const inputDir = body.inputDir;
  const outputDir = body.outputDir;
  const password = body.password;
  const encName = body.encName ?? false;
  const mode = body.mode === "decrypt" ? "decrypt" : "encrypt";

  try {
    const s = await stat(inputDir);
    if (!s.isDirectory()) {
      return c.json(
        { success: false, message: "Input path is not a directory" },
        400,
      );
    }
  } catch {
    return c.json(
      { success: false, message: "Input directory not found" },
      400,
    );
  }

  const encType = body.encType ?? "aesctr";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const files = await collectFiles(inputDir);
        const total = files.length;

        if (total === 0) {
          send({ type: "done", total: 0, success: 0, failed: 0 });
          controller.close();
          return;
        }

        send({
          type: "start",
          total,
          files: files.map((f) => path.relative(inputDir, f)),
        });

        let success = 0;
        let failed = 0;

        for (let i = 0; i < files.length; i++) {
          const filePath = files[i] as string;
          const relativePath = path.relative(inputDir, filePath);
          let outputPath = path.join(outputDir, relativePath);

          if (encName) {
            const dir = path.dirname(relativePath);
            const ext = path.extname(relativePath);
            const base = path.basename(relativePath, ext);
            if (mode === "encrypt") {
              const encBase = encodeName(password, encType as EncType, base);
              outputPath = path.join(outputDir, dir, encBase + ext);
            } else {
              const decoded = decodeName(password, encType as EncType, base);
              if (decoded) {
                outputPath = path.join(outputDir, dir, decoded + ext);
              }
            }
          }

          send({
            type: "progress",
            current: i + 1,
            total,
            file: relativePath,
            status: mode === "encrypt" ? "encrypting" : "decrypting",
          });

          try {
            const fileStats = await stat(filePath);
            const sizeSalt = fileStats.size;
            const fileSize = fileStats.size;
            const flowEnc = new FlowEnc(password, encType as EncType, sizeSalt);

            const { mkdirSync } = await import("node:fs");
            mkdirSync(path.dirname(outputPath), { recursive: true });

            const input = createReadStream(filePath);
            const output = createWriteStream(outputPath);
            const transform =
              mode === "encrypt"
                ? flowEnc.encryptTransform()
                : flowEnc.decryptTransform();

            // Track bytes through a PassThrough for progress reporting
            let bytesProcessed = 0;
            const progressStream = new PassThrough();
            progressStream.on("data", (chunk: Buffer) => {
              bytesProcessed += chunk.length;
              send({
                type: "file_progress",
                current: i + 1,
                total,
                file: relativePath,
                bytesProcessed,
                fileSize,
              });
            });

            await pipeline(input, transform, progressStream, output);

            success++;
            send({
              type: "progress",
              current: i + 1,
              total,
              file: relativePath,
              status: "done",
            });
          } catch (err) {
            failed++;
            send({
              type: "progress",
              current: i + 1,
              total,
              file: relativePath,
              status: "error",
              error: String(err),
            });
          }
        }

        send({ type: "done", total, success, failed });
      } catch (err) {
        send({ type: "error", error: String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

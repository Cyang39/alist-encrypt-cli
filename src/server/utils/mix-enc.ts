import crypto from "node:crypto";
import { Transform } from "node:stream";

class MixEnc {
  password: string;
  passwdOutward: string;
  encode: Buffer;
  decode: Buffer;

  constructor(password: string, _fileSize = 0) {
    this.password = password;
    this.passwdOutward = password;
    if (password.length !== 32) {
      this.passwdOutward = crypto
        .pbkdf2Sync(this.password, "MIX", 1000, 16, "sha256")
        .toString("hex");
    }
    const encodeHash = crypto
      .createHash("sha256")
      .update(this.passwdOutward)
      .digest();
    const decodeArr: number[] = [];
    const length = encodeHash.length;
    const decodeCheck: Record<number, number> = {};
    for (let i = 0; i < length; i++) {
      const byte = encodeHash[i] ?? 0;
      const enc = byte ^ i;
      if (!decodeCheck[enc % length]) {
        decodeArr[enc % length] = byte & 0xff;
        decodeCheck[enc % length] = byte;
      } else {
        for (let j = 0; j < length; j++) {
          if (!decodeCheck[j]) {
            encodeHash[i] = (byte & length) | (j ^ i);
            decodeArr[j] = (byte & length) | ((j ^ i) & 0xff);
            decodeCheck[j] = (byte & length) | (j ^ i);
            break;
          }
        }
      }
    }
    this.encode = encodeHash;
    this.decode = Buffer.from(decodeArr);
  }

  async setPositionAsync(): Promise<void> {
    // MixEnc does not support seeking
  }

  encryptTransform(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, next) => {
        next(null, this.encodeData(chunk));
      },
    });
  }

  decryptTransform(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, next) => {
        next(null, this.decodeData(chunk));
      },
    });
  }

  private encodeData(data: Buffer): Buffer {
    const buf = Buffer.from(data);
    for (let i = buf.length; i--; ) {
      const b = buf[i] ?? 0;
      buf[i] = b ^ (this.encode[b % 32] ?? 0);
    }
    return buf;
  }

  private decodeData(data: Buffer): Buffer {
    for (let i = data.length; i--; ) {
      const b = data[i] ?? 0;
      data[i] = b ^ (this.decode[b % 32] ?? 0);
    }
    return data;
  }
}

export default MixEnc;

import crypto from "node:crypto";

const source =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-~+";

function initKSA(passwd: string | Buffer): string {
  let key: Buffer;
  if (typeof passwd === "string") {
    key = crypto.createHash("sha256").update(passwd).digest();
  } else {
    key = passwd;
  }
  const K: number[] = [];
  const sbox: number[] = [];
  const sourceKey = source.split("");
  for (let i = 0; i < source.length; i++) {
    sbox[i] = i;
  }
  for (let i = 0; i < source.length; i++) {
    K[i] = key[i % key.length] ?? 0;
  }
  for (let i = 0, j = 0; i < source.length; i++) {
    j = (j + (sbox[i] ?? 0) + (K[i] ?? 0)) % source.length;
    const temp = sbox[i] ?? 0;
    sbox[i] = sbox[j] ?? 0;
    sbox[j] = temp;
  }
  let secret = "";
  for (const idx of sbox) {
    secret += sourceKey[idx] ?? "";
  }
  return secret;
}

class MixBase64 {
  chars: string[];
  private mapChars: Record<string, number>;

  constructor(passwd: string, salt = "mix64") {
    const secret = passwd.length === 64 ? passwd : initKSA(passwd + salt);
    this.chars = secret.split("");
    this.mapChars = {};
    this.chars.forEach((e, index) => {
      this.mapChars[e] = index;
    });
  }

  encode(bufferOrStr: Buffer | string, encoding: BufferEncoding = "utf-8") {
    const buffer =
      bufferOrStr instanceof Buffer
        ? bufferOrStr
        : (Buffer.from(bufferOrStr as string, encoding) as Buffer);
    let result = "";
    let arr: Buffer = Buffer.alloc(0);
    let char: string;
    for (let i = 0; i < buffer.length; i += 3) {
      if (i + 3 > buffer.length) {
        arr = buffer.subarray(i, buffer.length);
        break;
      }
      const b0 = buffer[i] ?? 0;
      const b1 = buffer[i + 1] ?? 0;
      const b2 = buffer[i + 2] ?? 0;
      char =
        (this.chars[b0 >> 2] ?? "") +
        (this.chars[((b0 & 3) << 4) | (b1 >> 4)] ?? "") +
        (this.chars[((b1 & 15) << 2) | (b2 >> 6)] ?? "") +
        (this.chars[b2 & 63] ?? "");
      result += char;
    }
    if (buffer.length % 3 === 1) {
      const a0 = arr[0] ?? 0;
      char =
        (this.chars[a0 >> 2] ?? "") +
        (this.chars[(a0 & 3) << 4] ?? "") +
        (this.chars[64] ?? "") +
        (this.chars[64] ?? "");
      result += char;
    } else if (buffer.length % 3 === 2) {
      const a0 = arr[0] ?? 0;
      const a1 = arr[1] ?? 0;
      char =
        (this.chars[a0 >> 2] ?? "") +
        (this.chars[((a0 & 3) << 4) | (a1 >> 4)] ?? "") +
        (this.chars[(a1 & 15) << 2] ?? "") +
        (this.chars[64] ?? "");
      result += char;
    }
    return result;
  }

  decode(base64Str: string): Buffer {
    let size = (base64Str.length / 4) * 3;
    let j = 0;
    const pad = this.chars[64] ?? "";
    if (~base64Str.indexOf(`${pad}${pad}`)) {
      size -= 2;
    } else if (~base64Str.indexOf(pad)) {
      size -= 1;
    }
    const buffer = Buffer.alloc(size);
    let i = 0;
    while (i < base64Str.length) {
      const enc1 = this.mapChars[base64Str.charAt(i++)] ?? 0;
      const enc2 = this.mapChars[base64Str.charAt(i++)] ?? 0;
      const enc3 = this.mapChars[base64Str.charAt(i++)] ?? 0;
      const enc4 = this.mapChars[base64Str.charAt(i++)] ?? 0;
      buffer.writeUInt8((enc1 << 2) | (enc2 >> 4), j++);
      if (enc3 !== 64) {
        buffer.writeUInt8(((enc2 & 15) << 4) | (enc3 >> 2), j++);
      }
      if (enc4 !== 64) {
        buffer.writeUInt8(((enc3 & 3) << 6) | enc4, j++);
      }
    }
    return buffer;
  }

  static sourceChars = source.split("");

  static getCheckBit(text: string): string {
    const bufferArr = Buffer.from(text);
    let count = 0;
    for (const num of bufferArr) {
      count += num;
    }
    count %= 64;
    return MixBase64.sourceChars[count] ?? "";
  }

  static getSourceChar(index: number): string {
    return source.split("")[index] ?? "";
  }

  static initKSA = initKSA;
}

export default MixBase64;

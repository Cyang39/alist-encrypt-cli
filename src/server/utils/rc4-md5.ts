import crypto from "node:crypto";
import { Transform } from "node:stream";

const segmentPosition = 100 * 10_000;

class Rc4Md5 {
  password: string;
  sizeSalt: number;
  passwdOutward: string;
  fileHexKey: string;
  position = 0;
  i = 0;
  j = 0;
  sbox: number[] = [];

  constructor(password: string, sizeSalt: number) {
    if (!sizeSalt) {
      throw new Error("salt is null");
    }
    this.password = password;
    this.sizeSalt = sizeSalt;
    this.passwdOutward = password;
    if (password.length !== 32) {
      this.passwdOutward = crypto
        .pbkdf2Sync(this.password, "RC4", 1000, 16, "sha256")
        .toString("hex");
    }
    const passwdSalt = this.passwdOutward + sizeSalt;
    this.fileHexKey = crypto.createHash("md5").update(passwdSalt).digest("hex");
    this.resetKSA();
  }

  private resetKSA(): void {
    const offset =
      Math.floor(this.position / segmentPosition) * segmentPosition;
    const buf = Buffer.alloc(4);
    buf.writeInt32BE(offset);
    const rc4Key = Buffer.from(this.fileHexKey, "hex");
    let j = rc4Key.length - buf.length;
    for (let i = 0; i < buf.length; i++, j++) {
      rc4Key[j] = (rc4Key[j] ?? 0) ^ (buf[i] ?? 0);
    }
    this.initKSA(rc4Key);
  }

  setPosition(newPosition: number): this {
    newPosition *= 1;
    this.position = newPosition;
    this.resetKSA();
    this.PRGAExecPosition(newPosition % segmentPosition);
    return this;
  }

  async setPositionAsync(newPosition: number): Promise<void> {
    newPosition *= 1;
    this.position = newPosition;
    this.resetKSA();
    // Simplified: run PRGA inline instead of worker thread
    this.PRGAExecPosition(newPosition % segmentPosition);
  }

  encryptTransform(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, next) => {
        next(null, this.encrypt(chunk));
      },
    });
  }

  decryptTransform(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, next) => {
        next(null, this.encrypt(chunk));
      },
    });
  }

  encrypt(plainBuffer: Buffer): Buffer {
    let { sbox: S, i, j } = this;
    for (let k = 0; k < plainBuffer.length; k++) {
      i = (i + 1) % 256;
      j = (j + (S[i] ?? 0)) % 256;
      const temp = S[i] ?? 0;
      S[i] = S[j] ?? 0;
      S[j] = temp;
      plainBuffer[k] =
        (plainBuffer[k] ?? 0) ^ (S[((S[i] ?? 0) + (S[j] ?? 0)) % 256] ?? 0);
      if (++this.position % segmentPosition === 0) {
        this.resetKSA();
        i = this.i;
        j = this.j;
        S = this.sbox;
      }
    }
    this.i = i;
    this.j = j;
    return plainBuffer;
  }

  private PRGAExecPosition(plainLen: number): void {
    let { sbox: S, i, j } = this;
    for (let k = 0; k < plainLen; k++) {
      i = (i + 1) % 256;
      j = (j + (S[i] ?? 0)) % 256;
      const temp = S[i] ?? 0;
      S[i] = S[j] ?? 0;
      S[j] = temp;
    }
    this.i = i;
    this.j = j;
  }

  private initKSA(key: Buffer): void {
    const K: number[] = [];
    for (let i = 0; i < 256; i++) {
      this.sbox[i] = i;
    }
    for (let i = 0; i < 256; i++) {
      K[i] = key[i % key.length] ?? 0;
    }
    for (let i = 0, j = 0; i < 256; i++) {
      j = (j + (this.sbox[i] ?? 0) + (K[i] ?? 0)) % 256;
      const temp = this.sbox[i] ?? 0;
      this.sbox[i] = this.sbox[j] ?? 0;
      this.sbox[j] = temp;
    }
    this.i = 0;
    this.j = 0;
  }
}

export default Rc4Md5;

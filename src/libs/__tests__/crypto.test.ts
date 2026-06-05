import { describe, expect, test } from "bun:test";
import { Readable, type Transform, Writable } from "node:stream";
import { decodeName, encodeName } from "../../server/utils/common.js";
import AesCTR from "../aes-ctr.js";
import CRCn from "../crc.js";
import FlowEnc from "../flow-enc.js";
import MixBase64 from "../mix-base64.js";
import MixEnc from "../mix-enc.js";
import Rc4Md5 from "../rc4-md5.js";

// 辅助函数：通过 Transform 流加密数据
async function encryptViaTransform(
  data: Buffer,
  transform: Transform,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = Readable.from(data);
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    readable.pipe(transform).pipe(writable);

    writable.on("finish", () => resolve(Buffer.concat(chunks)));
    writable.on("error", reject);
    transform.on("error", reject);
  });
}

// 测试数据
const TEST_PASSWORD = "test-password-123";
const TEST_PASSWORD_32 = "0123456789abcdef0123456789abcdef";
const TEST_DATA = Buffer.from(
  "Hello, World! This is a test message for encryption.",
);
const TEST_DATA_EMPTY = Buffer.alloc(0);
const TEST_DATA_LARGE = Buffer.alloc(1024 * 100); // 100KB
for (let i = 0; i < TEST_DATA_LARGE.length; i++) {
  TEST_DATA_LARGE[i] = i % 256;
}

describe("AES-128-CTR", () => {
  test("encrypt and decrypt with normal password", () => {
    const enc = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted).not.toEqual(TEST_DATA);

    const dec = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const decrypted = dec.decrypt(Buffer.from(encrypted));
    expect(decrypted).toEqual(TEST_DATA);
  });

  test("encrypt and decrypt with 32-char password", () => {
    const enc = new AesCTR(TEST_PASSWORD_32, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));

    const dec = new AesCTR(TEST_PASSWORD_32, TEST_DATA.length);
    const decrypted = dec.decrypt(Buffer.from(encrypted));
    expect(decrypted).toEqual(TEST_DATA);
  });

  test("encrypt and decrypt empty data", () => {
    const enc = new AesCTR(TEST_PASSWORD, 0);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA_EMPTY));
    expect(encrypted.length).toBe(0);
  });

  test("encrypt and decrypt large data", () => {
    const enc = new AesCTR(TEST_PASSWORD, TEST_DATA_LARGE.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA_LARGE));

    const dec = new AesCTR(TEST_PASSWORD, TEST_DATA_LARGE.length);
    const decrypted = dec.decrypt(Buffer.from(encrypted));
    expect(decrypted).toEqual(TEST_DATA_LARGE);
  });

  test("encrypt is deterministic", () => {
    const enc1 = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const enc2 = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const encrypted1 = enc1.encrypt(Buffer.from(TEST_DATA));
    const encrypted2 = enc2.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted1).toEqual(encrypted2);
  });

  test("different passwords produce different output", () => {
    const enc1 = new AesCTR("password1", TEST_DATA.length);
    const enc2 = new AesCTR("password2", TEST_DATA.length);
    const encrypted1 = enc1.encrypt(Buffer.from(TEST_DATA));
    const encrypted2 = enc2.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted1).not.toEqual(encrypted2);
  });

  test("setPositionAsync works correctly", async () => {
    const enc = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));

    const dec = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    await dec.setPositionAsync(0);
    const decrypted = dec.decrypt(Buffer.from(encrypted));
    expect(decrypted).toEqual(TEST_DATA);
  });

  test("encryptTransform and decryptTransform work", async () => {
    const enc = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = await encryptViaTransform(
      TEST_DATA,
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(TEST_DATA);

    const dec = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const decrypted = await encryptViaTransform(
      encrypted,
      dec.decryptTransform(),
    );
    expect(decrypted).toEqual(TEST_DATA);
  });
});

describe("RC4-MD5", () => {
  test("encrypt with normal password", () => {
    const enc = new Rc4Md5(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted).not.toEqual(TEST_DATA);
  });

  test("encrypt with 32-char password", () => {
    const enc = new Rc4Md5(TEST_PASSWORD_32, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted).not.toEqual(TEST_DATA);
  });

  test("throws on null salt", () => {
    expect(() => new Rc4Md5(TEST_PASSWORD, 0)).toThrow("salt is null");
  });

  test("encrypt large data", () => {
    const enc = new Rc4Md5(TEST_PASSWORD, TEST_DATA_LARGE.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA_LARGE));
    expect(encrypted).not.toEqual(TEST_DATA_LARGE);
  });

  test("encrypt is deterministic", () => {
    const enc1 = new Rc4Md5(TEST_PASSWORD, TEST_DATA.length);
    const enc2 = new Rc4Md5(TEST_PASSWORD, TEST_DATA.length);
    const encrypted1 = enc1.encrypt(Buffer.from(TEST_DATA));
    const encrypted2 = enc2.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted1).toEqual(encrypted2);
  });

  test("different passwords produce different output", () => {
    const enc1 = new Rc4Md5("password1", TEST_DATA.length);
    const enc2 = new Rc4Md5("password2", TEST_DATA.length);
    const encrypted1 = enc1.encrypt(Buffer.from(TEST_DATA));
    const encrypted2 = enc2.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted1).not.toEqual(encrypted2);
  });

  test("setPositionAsync works correctly", async () => {
    const enc = new Rc4Md5(TEST_PASSWORD, TEST_DATA.length);
    await enc.setPositionAsync(0);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted).not.toEqual(TEST_DATA);
  });

  test("encryptTransform works", async () => {
    const enc = new Rc4Md5(TEST_PASSWORD, TEST_DATA.length);
    const testDataCopy = Buffer.from(TEST_DATA);
    const encrypted = await encryptViaTransform(
      Buffer.from(TEST_DATA),
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(testDataCopy);
  });
});

describe("MixEnc", () => {
  test("encrypt with normal password", async () => {
    const enc = new MixEnc(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = await encryptViaTransform(
      TEST_DATA,
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(TEST_DATA);
  });

  test("encrypt with 32-char password", async () => {
    const enc = new MixEnc(TEST_PASSWORD_32, TEST_DATA.length);
    const encrypted = await encryptViaTransform(
      TEST_DATA,
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(TEST_DATA);
  });

  test("encrypt large data", async () => {
    const enc = new MixEnc(TEST_PASSWORD, TEST_DATA_LARGE.length);
    const encrypted = await encryptViaTransform(
      TEST_DATA_LARGE,
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(TEST_DATA_LARGE);
  });

  test("encrypt is deterministic", async () => {
    const enc1 = new MixEnc(TEST_PASSWORD, TEST_DATA.length);
    const enc2 = new MixEnc(TEST_PASSWORD, TEST_DATA.length);

    const encrypted1 = await encryptViaTransform(
      TEST_DATA,
      enc1.encryptTransform(),
    );
    const encrypted2 = await encryptViaTransform(
      TEST_DATA,
      enc2.encryptTransform(),
    );
    expect(encrypted1).toEqual(encrypted2);
  });

  test("different passwords produce different output", async () => {
    const enc1 = new MixEnc("password1", TEST_DATA.length);
    const enc2 = new MixEnc("password2", TEST_DATA.length);

    const encrypted1 = await encryptViaTransform(
      TEST_DATA,
      enc1.encryptTransform(),
    );
    const encrypted2 = await encryptViaTransform(
      TEST_DATA,
      enc2.encryptTransform(),
    );
    expect(encrypted1).not.toEqual(encrypted2);
  });

  test("encryptTransform and decryptTransform work", async () => {
    const enc = new MixEnc(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = await encryptViaTransform(
      TEST_DATA,
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(TEST_DATA);

    const dec = new MixEnc(TEST_PASSWORD, TEST_DATA.length);
    const decrypted = await encryptViaTransform(
      encrypted,
      dec.decryptTransform(),
    );
    expect(decrypted).toEqual(TEST_DATA);
  });
});

describe("CRC", () => {
  test("CRC6 produces consistent checksums", () => {
    const crc = new CRCn(6);
    const data1 = Buffer.from("test data");
    const data2 = Buffer.from("test data");
    expect(crc.checksum(data1)).toBe(crc.checksum(data2));
  });

  test("CRC6 produces different checksums for different data", () => {
    const crc = new CRCn(6);
    const data1 = Buffer.from("test data 1");
    const data2 = Buffer.from("test data 2");
    expect(crc.checksum(data1)).not.toBe(crc.checksum(data2));
  });

  test("CRC8 produces consistent checksums", () => {
    const crc = new CRCn(8);
    const data1 = Buffer.from("test data");
    const data2 = Buffer.from("test data");
    expect(crc.checksum(data1)).toBe(crc.checksum(data2));
  });

  test("CRC8 produces different checksums for different data", () => {
    const crc = new CRCn(8);
    const data1 = Buffer.from("test data 1");
    const data2 = Buffer.from("test data 2");
    expect(crc.checksum(data1)).not.toBe(crc.checksum(data2));
  });
});

describe("MixBase64", () => {
  test("encode and decode with normal password", () => {
    const mix64 = new MixBase64(TEST_PASSWORD);
    const encoded = mix64.encode("Hello, World!");
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = mix64.decode(encoded);
    expect(decoded.toString()).toBe("Hello, World!");
  });

  test("encode and decode with buffer", () => {
    const mix64 = new MixBase64(TEST_PASSWORD);
    const data = Buffer.from("Test buffer data");
    const encoded = mix64.encode(data);
    const decoded = mix64.decode(encoded);
    expect(decoded).toEqual(data);
  });

  test("encode and decode empty string", () => {
    const mix64 = new MixBase64(TEST_PASSWORD);
    const encoded = mix64.encode("");
    const decoded = mix64.decode(encoded);
    expect(decoded.toString()).toBe("");
  });

  test("different passwords produce different encodings", () => {
    const mix64_1 = new MixBase64("password1");
    const mix64_2 = new MixBase64("password2");
    const encoded1 = mix64_1.encode("Hello");
    const encoded2 = mix64_2.encode("Hello");
    expect(encoded1).not.toBe(encoded2);
  });

  test("getCheckBit returns consistent values", () => {
    const check1 = MixBase64.getCheckBit("test data");
    const check2 = MixBase64.getCheckBit("test data");
    expect(check1).toBe(check2);
  });

  test("getSourceChar returns valid characters", () => {
    for (let i = 0; i < 64; i++) {
      const char = MixBase64.getSourceChar(i);
      expect(typeof char).toBe("string");
      expect(char.length).toBe(1);
    }
  });
});

describe("FlowEnc", () => {
  test("aesctr creates encrypt and decrypt transforms", () => {
    const enc = new FlowEnc(TEST_PASSWORD, "aesctr", TEST_DATA.length);
    const encTransform = enc.encryptTransform();
    const decTransform = enc.decryptTransform();
    expect(encTransform).toBeDefined();
    expect(decTransform).toBeDefined();
  });

  test("rc4 creates encrypt and decrypt transforms", () => {
    const enc = new FlowEnc(TEST_PASSWORD, "rc4", TEST_DATA.length);
    expect(enc.encryptType).toBe("rc4");
    expect(enc.passwdOutward).toBeDefined();
    const encTransform = enc.encryptTransform();
    const decTransform = enc.decryptTransform();
    expect(encTransform).toBeDefined();
    expect(decTransform).toBeDefined();
  });

  test("mix creates encrypt and decrypt transforms", () => {
    const enc = new FlowEnc(TEST_PASSWORD, "mix", TEST_DATA.length);
    expect(enc.encryptType).toBe("mix");
    expect(enc.passwdOutward).toBeDefined();
    const encTransform = enc.encryptTransform();
    const decTransform = enc.decryptTransform();
    expect(encTransform).toBeDefined();
    expect(decTransform).toBeDefined();
  });

  test("throws on unknown encrypt type", () => {
    expect(
      () => new FlowEnc(TEST_PASSWORD, "unknown" as never, TEST_DATA.length),
    ).toThrow("unknown encryptType");
  });

  test("getPassWdOutward returns consistent values", () => {
    const passwd1 = FlowEnc.getPassWdOutward(TEST_PASSWORD, "aesctr");
    const passwd2 = FlowEnc.getPassWdOutward(TEST_PASSWORD, "aesctr");
    expect(passwd1).toBe(passwd2);
  });

  test("getPassWdOutward returns different values for different algorithms", () => {
    const passwdAes = FlowEnc.getPassWdOutward(TEST_PASSWORD, "aesctr");
    const passwdRc4 = FlowEnc.getPassWdOutward(TEST_PASSWORD, "rc4");
    const passwdMix = FlowEnc.getPassWdOutward(TEST_PASSWORD, "mix");
    expect(passwdAes).not.toBe(passwdRc4);
    expect(passwdAes).not.toBe(passwdMix);
    expect(passwdRc4).not.toBe(passwdMix);
  });
});

describe("encodeName and decodeName", () => {
  test("encode and decode filename with aesctr", () => {
    const encoded = encodeName(TEST_PASSWORD, "aesctr", "test-file.txt");
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = decodeName(TEST_PASSWORD, "aesctr", encoded);
    expect(decoded).toBe("test-file.txt");
  });

  test("encode and decode filename with rc4", () => {
    const encoded = encodeName(TEST_PASSWORD, "rc4", "test-file.txt");
    const decoded = decodeName(TEST_PASSWORD, "rc4", encoded);
    expect(decoded).toBe("test-file.txt");
  });

  test("encode and decode filename with mix", () => {
    const encoded = encodeName(TEST_PASSWORD, "mix", "test-file.txt");
    const decoded = decodeName(TEST_PASSWORD, "mix", encoded);
    expect(decoded).toBe("test-file.txt");
  });

  test("decode fails with wrong password", () => {
    const encoded = encodeName(TEST_PASSWORD, "aesctr", "test-file.txt");
    const decoded = decodeName("wrong-password", "aesctr", encoded);
    expect(decoded).toBeNull();
  });

  test("decode fails with wrong algorithm", () => {
    const encoded = encodeName(TEST_PASSWORD, "aesctr", "test-file.txt");
    const decoded = decodeName(TEST_PASSWORD, "rc4", encoded);
    expect(decoded).toBeNull();
  });

  test("encode and decode empty filename", () => {
    const encoded = encodeName(TEST_PASSWORD, "aesctr", "");
    const decoded = decodeName(TEST_PASSWORD, "aesctr", encoded);
    expect(decoded).toBe("");
  });

  test("encode and decode filename with special characters", () => {
    const specialName = "文件 名称 (1).txt";
    const encoded = encodeName(TEST_PASSWORD, "aesctr", specialName);
    const decoded = decodeName(TEST_PASSWORD, "aesctr", encoded);
    expect(decoded).toBe(specialName);
  });
});

describe("Cross-algorithm compatibility", () => {
  test("AES-CTR encrypted data can be decrypted by same algorithm", () => {
    const enc = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));

    const dec = new AesCTR(TEST_PASSWORD, TEST_DATA.length);
    const decrypted = dec.decrypt(Buffer.from(encrypted));
    expect(decrypted).toEqual(TEST_DATA);
  });

  test("RC4-MD5 can encrypt data", () => {
    const enc = new Rc4Md5(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = enc.encrypt(Buffer.from(TEST_DATA));
    expect(encrypted).not.toEqual(TEST_DATA);
  });

  test("MixEnc can encrypt data via transform", async () => {
    const enc = new MixEnc(TEST_PASSWORD, TEST_DATA.length);
    const encrypted = await encryptViaTransform(
      TEST_DATA,
      enc.encryptTransform(),
    );
    expect(encrypted).not.toEqual(TEST_DATA);
  });
});

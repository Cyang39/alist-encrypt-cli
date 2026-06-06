import type { EncType } from "../types.js";
import AesCTR from "./aes-ctr.js";
import MixEnc from "./mix-enc.js";
import Rc4Md5 from "./rc4-md5.js";

const cachePasswdOutward: Record<string, string> = {};

class FlowEnc {
  passwdOutward: string;
  encryptFlow: AesCTR | Rc4Md5 | MixEnc;
  encryptType: EncType;

  constructor(password: string, encryptType: EncType, fileSize: number) {
    fileSize *= 1;
    let encryptFlow: AesCTR | Rc4Md5 | MixEnc;

    if (encryptType === "mix") {
      encryptFlow = new MixEnc(password, fileSize);
    } else if (encryptType === "rc4") {
      encryptFlow = new Rc4Md5(password, fileSize);
    } else if (encryptType === "aesctr") {
      encryptFlow = new AesCTR(password, fileSize);
    } else {
      throw new Error(`FlowEnc error: unknown encryptType ${encryptType}`);
    }

    this.passwdOutward = encryptFlow.passwdOutward;
    this.encryptFlow = encryptFlow;
    this.encryptType = encryptType;
    cachePasswdOutward[password + encryptType] = this.passwdOutward;
  }

  async setPosition(position: number): Promise<void> {
    await this.encryptFlow.setPositionAsync(position);
  }

  encryptTransform() {
    return this.encryptFlow.encryptTransform();
  }

  decryptTransform() {
    return this.encryptFlow.decryptTransform();
  }

  static getPassWdOutward(password: string, encryptType: EncType): string {
    const cached = cachePasswdOutward[password + encryptType];
    if (cached) return cached;
    const flowEnc = new FlowEnc(password, encryptType, 1);
    return flowEnc.passwdOutward;
  }
}

export default FlowEnc;

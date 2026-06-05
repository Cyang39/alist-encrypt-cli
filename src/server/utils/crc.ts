class CRCn {
  table: number[];
  initialValue: number;

  constructor(num: number, polynomial?: number, initialValue = 0) {
    this.initialValue = initialValue;
    this.table =
      num === 6
        ? CRCn.generateTable6()
        : CRCn.generateTable8MAXIM(polynomial ?? CRCn.POLY8.CRC8_DALLAS_MAXIM);
  }

  checksum(byteArray: Buffer): number {
    let c = this.initialValue;
    for (let i = 0; i < byteArray.length; i++) {
      c = this.table[(c ^ (byteArray[i] ?? 0)) % 256] ?? 0;
    }
    return c;
  }

  static generateTable8MAXIM(_polynomial: number): number[] {
    const csTable: number[] = [];
    for (let i = 0; i < 256; ++i) {
      let curr = i;
      for (let j = 0; j < 8; ++j) {
        if ((curr & 0x01) !== 0) {
          curr = ((curr >> 1) ^ 0x8c) % 256;
        } else {
          curr = (curr >> 1) % 256;
        }
      }
      csTable[i] = curr;
    }
    return csTable;
  }

  static generateTable6(): number[] {
    const csTable: number[] = [];
    for (let i = 0; i < 256; i++) {
      let curr = i;
      for (let j = 0; j < 8; ++j) {
        if ((curr & 0x01) !== 0) {
          curr = ((curr >> 1) ^ 0x30) % 256;
        } else {
          curr = (curr >> 1) % 256;
        }
      }
      csTable[i] = curr;
    }
    return csTable;
  }

  static POLY8 = {
    CRC8: 0xd5,
    CRC8_CCITT: 0x07,
    CRC8_DALLAS_MAXIM: 0x31,
    CRC8_SAE_J1850: 0x1d,
    CRC_8_WCDMA: 0x9b,
  } as const;
}

export default CRCn;

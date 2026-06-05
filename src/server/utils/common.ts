import path from "node:path";

import type { PasswdInfo } from "../types.js";
import CRCn from "./crc.js";
import FlowEnc from "./flow-enc.js";
import MixBase64 from "./mix-base64.js";

const crc6 = new CRCn(6);
const origPrefix = "orig_";

/**
 * 简单 glob 转 regex：支持 * 通配符（匹配任意字符）
 * 用于匹配 encPath 中的路径模式，如 "encrypt_folder/*"
 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${pattern}$`);
}

export function pathExec(
  encPath: string[],
  url: string,
): RegExpExecArray | null {
  for (const filePath of encPath) {
    const result = globToRegex(filePath).exec(url);
    if (result) return result;
  }
  return null;
}

export function encodeName(
  password: string,
  encType: string,
  plainName: string,
): string {
  const passwdOutward = FlowEnc.getPassWdOutward(
    password,
    encType as "aesctr" | "rc4" | "mix",
  );
  const mix64 = new MixBase64(passwdOutward);
  let encoded = mix64.encode(plainName);
  const crc6Bit = crc6.checksum(Buffer.from(encoded + passwdOutward));
  const crc6Check = MixBase64.getSourceChar(crc6Bit);
  encoded += crc6Check;
  return encoded;
}

export function decodeName(
  password: string,
  encType: string,
  encodedName: string,
): string | null {
  const crc6Check = encodedName.substring(encodedName.length - 1);
  const passwdOutward = FlowEnc.getPassWdOutward(
    password,
    encType as "aesctr" | "rc4" | "mix",
  );
  const mix64 = new MixBase64(passwdOutward);
  const subEncName = encodedName.substring(0, encodedName.length - 1);
  const crc6Bit = crc6.checksum(Buffer.from(subEncName + passwdOutward));
  if (MixBase64.getSourceChar(crc6Bit) !== crc6Check) {
    return null;
  }
  try {
    return mix64.decode(subEncName).toString("utf8");
  } catch {
    return null;
  }
}

export function encodeFolderName(
  password: string,
  encType: string,
  folderPasswd: string,
  folderEncType: string,
): string {
  const passwdInfo = `${folderEncType}_${folderPasswd}`;
  return encodeName(password, encType, passwdInfo);
}

export function decodeFolderName(
  password: string,
  encType: string,
  encodedName: string,
): { folderEncType: string; folderPasswd: string } | false {
  const arr = encodedName.split("_");
  if (arr.length < 2) return false;
  const folderEncName = arr[arr.length - 1] ?? "";
  const decoded = decodeName(password, encType, folderEncName);
  if (!decoded) return false;
  const underscoreIdx = decoded.indexOf("_");
  const folderEncType = decoded.substring(0, underscoreIdx);
  const folderPasswd = decoded.substring(underscoreIdx + 1);
  return { folderEncType, folderPasswd };
}

export function pathFindPasswd(
  passwdList: PasswdInfo[],
  url: string,
):
  | { passwdInfo: PasswdInfo; pathInfo: RegExpExecArray }
  | Record<string, never> {
  for (const passwdInfo of passwdList) {
    if (!passwdInfo.enable) continue;
    for (const filePath of passwdInfo.encPath) {
      const result = globToRegex(filePath).exec(url);
      if (result) {
        const newPasswdInfo = { ...passwdInfo };
        const folders = url.split("/");
        for (const folderName of folders) {
          const data = decodeFolderName(
            passwdInfo.password,
            passwdInfo.encType,
            decodeURIComponent(folderName),
          );
          if (data) {
            newPasswdInfo.encType = data.folderEncType as
              | "aesctr"
              | "rc4"
              | "mix";
            newPasswdInfo.password = data.folderPasswd;
            return {
              passwdInfo: newPasswdInfo,
              pathInfo: result,
            };
          }
        }
        return {
          passwdInfo,
          pathInfo: result,
        };
      }
    }
  }
  return {};
}

export function convertRealName(
  password: string,
  encType: string,
  pathText: string,
): string {
  const fileName = path.basename(pathText);
  if (fileName.indexOf(origPrefix) === 0) {
    return fileName.replace(origPrefix, "");
  }
  const ext = path.extname(fileName);
  const encoded = encodeName(password, encType, decodeURIComponent(fileName));
  return encoded + ext;
}

export function convertShowName(
  password: string,
  encType: string,
  pathText: string,
): string {
  const fileName = path.basename(decodeURIComponent(pathText));
  const ext = path.extname(fileName);
  const encName = fileName.replace(ext, "");
  let showName = decodeName(password, encType, encName);
  if (showName === null) {
    showName = origPrefix + fileName;
  }
  return showName;
}

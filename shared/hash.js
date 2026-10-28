const { keccak256, toUtf8Bytes } = require("ethers");

/** 32 字节零值。空的维修备注用这个值，不调用 POST /notes。 */
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

const ROLE_NAME = {
  manufacturer: "MANUFACTURER_ROLE",
  retailer: "RETAILER_ROLE",
  serviceCenter: "SERVICE_CENTER_ROLE",
};

/** 与 Solidity keccak256(bytes(value)) 相同，使用 UTF-8 字节。 */
function hashUtf8(value) {
  return keccak256(toUtf8Bytes(value));
}

/** 序列号和型号名称只去掉两端空白，不改变大小写。 */
function normalizeText(value) {
  return value.trim();
}

/** keccak256(utf8(trim(serial)))。空白序列号直接拒绝。 */
function serialHash(serial) {
  const normalized = normalizeText(serial);
  if (normalized.length === 0) {
    throw new Error("serial is empty");
  }
  return hashUtf8(normalized);
}

/**
 * uint256(keccak256(utf8(trim(modelName)))) 的十进制字符串。
 * 传给合约时用 BigInt，禁止用 Number。
 */
function modelIdFromName(modelName) {
  const normalized = normalizeText(modelName);
  if (normalized.length === 0) {
    throw new Error("modelName is empty");
  }
  return BigInt(hashUtf8(normalized)).toString(10);
}

/** 故障描述不 trim。空字符串拒绝。两端空格会改变哈希。 */
function reasonHash(reasonText) {
  if (typeof reasonText !== "string" || reasonText.length === 0) {
    throw new Error("reasonText is empty");
  }
  return hashUtf8(reasonText);
}

/** 空备注返回 ZERO_BYTES32。非空备注不 trim。 */
function noteHash(noteText) {
  if (typeof noteText !== "string" || noteText.length === 0) {
    return ZERO_BYTES32;
  }
  return hashUtf8(noteText);
}

/** 与 contracts/types/Roles.sol 里的常量相同。 */
function roleHash(roleName) {
  if (typeof roleName !== "string" || roleName.length === 0) {
    throw new Error("roleName is empty");
  }
  return hashUtf8(roleName);
}

module.exports = {
  ZERO_BYTES32,
  ROLE_NAME,
  hashUtf8,
  normalizeText,
  serialHash,
  modelIdFromName,
  reasonHash,
  noteHash,
  roleHash,
};

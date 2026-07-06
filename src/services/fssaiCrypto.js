const CryptoJS = require("crypto-js");

const W_ARRAY = [
  105, 100, 100, 96, 65, 82, 79, 78, 27, 107, 64, 123, 67, 103, 82, 101, 110,
  73, 30, 123, 107, 23, 23,
];
const P_ARRAY = [
  26, 104, 98, 99, 26, 66, 79, 79, 65, 30, 64, 127, 121, 103, 82, 100, 126, 111,
  83, 96, 77, 23, 23,
];

const AES_OPTIONS = {
  mode: CryptoJS.mode.ECB,
  padding: CryptoJS.pad.Pkcs7,
};

function deriveKey(prefixByte, arr) {
  const keyString =
    [prefixByte]
      .map((value) => String.fromCharCode(42 ^ value))
      .join("") +
    arr
      .map((value) => String.fromCharCode(42 ^ value))
      .join("")
      .split("")
      .map((char) => String.fromCharCode(42 ^ char.charCodeAt(0)))
      .map((char) => String.fromCharCode(42 ^ char.charCodeAt(0)))
      .join("");

  return CryptoJS.enc.Base64.parse(keyString);
}

const REQUEST_KEY = deriveKey(124, W_ARRAY);
const RESPONSE_KEY = deriveKey(121, P_ARRAY);

function encryptRequest(plaintext) {
  return CryptoJS.AES.encrypt(plaintext, REQUEST_KEY, AES_OPTIONS).toString();
}

function decryptResponse(ciphertext) {
  return CryptoJS.AES.decrypt(ciphertext, RESPONSE_KEY, AES_OPTIONS).toString(
    CryptoJS.enc.Utf8
  );
}

function parseDecryptedJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

function parseEncryptedApiResponse(bodyText) {
  const parsed = JSON.parse(bodyText);
  if (!parsed.encryptedResponse) {
    return parsed;
  }
  const decryptedText = decryptResponse(parsed.encryptedResponse);
  return parseDecryptedJson(decryptedText);
}

module.exports = {
  encryptRequest,
  decryptResponse,
  parseDecryptedJson,
  parseEncryptedApiResponse,
};

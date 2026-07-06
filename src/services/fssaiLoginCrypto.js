const CryptoJS = require("crypto-js");

const CHALLENGE = "$$CHALLENGE";

function buildLoginSecrets(plainPassword) {
  if (!plainPassword) {
    throw new Error("Plain password is required");
  }

  const md5Password = CryptoJS.HmacMD5(plainPassword, CHALLENGE).toString(
    CryptoJS.enc.Hex
  );
  const password = CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(plainPassword, CHALLENGE)
  );

  return { password, md5Password };
}

module.exports = {
  buildLoginSecrets,
  CHALLENGE,
};

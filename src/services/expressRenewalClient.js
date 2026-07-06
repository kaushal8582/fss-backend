const { foscosRequest } = require("./fssaiClient");
const { parseEncryptedApiResponse } = require("./fssaiCrypto");

async function encryptedGet(apiPath) {
  const response = await foscosRequest("GET", apiPath, null, { skipAuth: true });

  if (response.status !== 200) {
    const snippet = response.body.toString("utf8").slice(0, 200);
    throw new Error(`FSSAI ${apiPath} failed (${response.status}): ${snippet}`);
  }

  try {
    return parseEncryptedApiResponse(response.body.toString("utf8"));
  } catch (err) {
    throw new Error(`Failed to parse response from ${apiPath}: ${err.message}`);
  }
}

async function getCompleteRegistrationPrev(refId) {
  const apiPath = `/gateway/common/express-renewal/getcompleteregistrationprev/${refId}`;
  const data = await encryptedGet(apiPath);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Complete registration response is empty");
  }
  return data[0];
}

module.exports = {
  getCompleteRegistrationPrev,
};

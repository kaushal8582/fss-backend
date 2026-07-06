const https = require("https");
const { getCredentials } = require("./authCredentials");
const { decryptResponse, parseDecryptedJson } = require("./fssaiCrypto");

const BASE_URL = "https://foscos.fssai.gov.in";

const DEFAULT_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,hi;q=0.6",
  Connection: "keep-alive",
  "Content-Type": "application/json",
  Referer: "https://foscos.fssai.gov.in/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
  "sec-ch-ua":
    '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
};

function isPdfBuffer(buffer) {
  return buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "%PDF";
}

function foscosRequest(method, apiPath, body, options = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(apiPath, BASE_URL);
    const creds = getCredentials();
    const skipAuth = options.skipAuth === true;

    const headers = {
      ...DEFAULT_HEADERS,
      ...(skipAuth
        ? {}
        : {
            Authorization: `Bearer ${creds.bearerToken}`,
            "x-auth-user-id": creds.xAuthUserId,
          }),
      ...(skipAuth
        ? options.cookie != null
          ? { Cookie: options.cookie }
          : {}
        : { Cookie: options.cookie || creds.cookie }),
      ...options.extraHeaders,
      ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
    };

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    req.on("error", reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

function extractPdfBufferFromResponse(registrationId, response) {
  const contentType = response.headers["content-type"] || "";
  const bodyText = response.body.toString("utf8");

  if (contentType.includes("application/pdf") || isPdfBuffer(response.body)) {
    return { pdfBuffer: response.body };
  }

  try {
    const parsed = JSON.parse(bodyText);

    if (parsed.encryptedResponse) {
      const decryptedText = decryptResponse(parsed.encryptedResponse);

      try {
        const decryptedJson = JSON.parse(decryptedText);
        const pdfBase64 =
          decryptedJson.pdf ||
          decryptedJson.fileContent ||
          decryptedJson.content ||
          decryptedJson.data;

        if (pdfBase64 && typeof pdfBase64 === "string") {
          return { pdfBuffer: Buffer.from(pdfBase64, "base64") };
        }

        return {
          error: "Decrypted response did not contain PDF data",
          decrypted: decryptedJson,
        };
      } catch {
        if (isPdfBuffer(Buffer.from(decryptedText, "utf8"))) {
          return { pdfBuffer: Buffer.from(decryptedText, "utf8") };
        }

        const pdfBuffer = Buffer.from(decryptedText, "base64");
        if (isPdfBuffer(pdfBuffer)) {
          return { pdfBuffer };
        }

        return {
          error: "Could not extract PDF from encrypted response",
          decrypted: parseDecryptedJson(decryptedText),
        };
      }
    }
  } catch {
    // Not JSON
  }

  if (isPdfBuffer(response.body)) {
    return { pdfBuffer: response.body };
  }

  return {
    error: "Unexpected PDF response format",
    raw: bodyText.slice(0, 500),
  };
}

async function downloadRegistrationPdfBuffer(registrationId) {
  const apiPath = `/gateway/downloadpdf6/registration/${registrationId}`;
  const response = await foscosRequest("GET", apiPath);

  if (response.status !== 200) {
    const error =
      response.status === 401
        ? "FSSAI auth expired (401) — paste a fresh bearer token"
        : "Failed to download PDF";
    return {
      status: response.status,
      refId: registrationId,
      error,
      authExpired: response.status === 401,
    };
  }

  const result = extractPdfBufferFromResponse(registrationId, response);

  if (result.error || !result.pdfBuffer) {
    return {
      status: response.status,
      refId: registrationId,
      error: result.error || "No PDF buffer",
      ...result,
    };
  }

  return {
    status: response.status,
    refId: registrationId,
    pdfBuffer: result.pdfBuffer,
    sizeBytes: result.pdfBuffer.length,
  };
}

async function downloadLicensePdfBuffer(refId, licenseCategoryId) {
  const creds = getCredentials();
  const categoryId = licenseCategoryId || 2;
  const query =
    `?token=${encodeURIComponent(creds.bearerToken)}` +
    `&x-auth-user-id=${encodeURIComponent(creds.xAuthUserId)}`;
  const apiPath = `/gateway/downloadpdf3/license/${refId}/${categoryId}${query}`;
  const response = await foscosRequest("GET", apiPath);

  if (response.status !== 200) {
    const error =
      response.status === 401
        ? "FSSAI auth expired (401) — paste a fresh bearer token"
        : "Failed to download license PDF";
    return {
      status: response.status,
      refId,
      error,
      authExpired: response.status === 401,
    };
  }

  const result = extractPdfBufferFromResponse(refId, response);

  if (result.error || !result.pdfBuffer) {
    return {
      status: response.status,
      refId,
      error: result.error || "No PDF buffer",
      ...result,
    };
  }

  return {
    status: response.status,
    refId,
    pdfBuffer: result.pdfBuffer,
    sizeBytes: result.pdfBuffer.length,
  };
}

module.exports = {
  downloadRegistrationPdfBuffer,
  downloadLicensePdfBuffer,
  foscosRequest,
};

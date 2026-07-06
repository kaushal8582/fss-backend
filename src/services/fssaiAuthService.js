const { env } = require("../config/env");
const { encryptRequest, parseEncryptedApiResponse } = require("./fssaiCrypto");
const { buildLoginSecrets } = require("./fssaiLoginCrypto");
const { foscosRequest } = require("./fssaiClient");
const { updateCredentials, getCredentials } = require("./authCredentials");

let refreshInFlight = null;
let lastRefreshAttemptAt = 0;
const REFRESH_DEBOUNCE_MS = 60_000;

function mergeSetCookies(existingCookie, setCookieHeaders) {
  const map = new Map();
  const base = existingCookie || "";
  base.split(";").forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  });

  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];

  for (const header of headers) {
    const pair = header.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }

  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function extractTimeOutSpan(step1Response, decrypted) {
  const headerVal =
    step1Response.headers["timeoutspan"] ||
    step1Response.headers["timeOutSpan"] ||
    step1Response.headers["time-out-span"];

  if (headerVal) return headerVal;

  if (!decrypted || typeof decrypted !== "object") {
    return null;
  }

  return (
    decrypted.timeSpan ||
    decrypted.timeOutSpan ||
    decrypted.timeoutSpan ||
    decrypted.timeOutspan ||
    (typeof decrypted._raw === "string" && decrypted._raw.length > 20
      ? decrypted._raw
      : null)
  );
}

function extractBearerToken(decrypted, responseHeaders) {
  if (decrypted && typeof decrypted === "object") {
    const nested = decrypted.data && typeof decrypted.data === "object" ? decrypted.data : null;
    const token =
      decrypted.accessToken ||
      decrypted.token ||
      decrypted.jwt ||
      decrypted.jwtToken ||
      decrypted.bearerToken ||
      decrypted.authToken ||
      decrypted.access_token ||
      nested?.accessToken ||
      nested?.token ||
      nested?.jwt;
    if (token && typeof token === "string") {
      return token.startsWith("Bearer ") ? token.slice(7) : token;
    }
  }

  const authHeader = responseHeaders.authorization || responseHeaders.Authorization;
  if (authHeader && typeof authHeader === "string") {
    return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  }

  return null;
}

function extractXAuthUserId(decrypted, responseHeaders) {
  const headerVal =
    responseHeaders["x-auth-user-id"] || responseHeaders["X-Auth-User-Id"];
  if (headerVal) return headerVal;

  if (!decrypted || typeof decrypted !== "object") return null;

  return (
    decrypted.xAuthUserId ||
    decrypted["x-auth-user-id"] ||
    decrypted.authUserId ||
    decrypted.userAuthId ||
    null
  );
}

function getBaseCookie() {
  return env.fssaiBaseCookie || env.cookie || getCredentials().cookie;
}

function validateLoginConfig() {
  const missing = [];
  if (!env.fssaiUsername) missing.push("FSSAI_USERNAME");
  if (!env.fssaiDisplayRefId) missing.push("FSSAI_DISPLAY_REF_ID");

  const hasPlainPassword = Boolean(env.fssaiPlainPassword);
  const hasEncryptedPair = Boolean(
    env.fssaiPasswordEncrypted && env.fssaiMd5Password
  );

  if (!hasPlainPassword && !hasEncryptedPair) {
    missing.push("FSSAI_PLAIN_PASSWORD (or FSSAI_PASSWORD_ENCRYPTED + FSSAI_MD5_PASSWORD)");
  }

  if (missing.length) {
    throw new Error(`FSSAI auto-login not configured: missing ${missing.join(", ")}`);
  }
}

function resolveLoginSecrets() {
  if (env.fssaiPlainPassword) {
    return buildLoginSecrets(env.fssaiPlainPassword);
  }

  return {
    password: env.fssaiPasswordEncrypted,
    md5Password: env.fssaiMd5Password,
  };
}

async function fetchCsrfCookie(baseCookie) {
  const response = await foscosRequest(
    "GET",
    "/gateway/api/auth/csrf-token",
    null,
    { skipAuth: true, cookie: baseCookie || "" }
  );

  if (response.status !== 200) {
    throw new Error(
      `csrf-token failed (${response.status}): ${response.body.toString("utf8").slice(0, 200)}`
    );
  }

  return mergeSetCookies(baseCookie || "", response.headers["set-cookie"]);
}

async function fetchPublicIpAddress() {
  return new Promise((resolve) => {
    const https = require("https");
    https
      .get("https://api.ipify.org/?format=json", (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).ip || env.fssaiIpAddress);
          } catch {
            resolve(env.fssaiIpAddress);
          }
        });
      })
      .on("error", () => resolve(env.fssaiIpAddress));
  });
}

async function prepareLoginCookie() {
  const baseCookie = getBaseCookie();
  return fetchCsrfCookie(baseCookie);
}

async function callGetUserLoginId(cookie) {
  const payload = { displayRefId: env.fssaiDisplayRefId };
  const response = await foscosRequest(
    "POST",
    "/gateway/commonauth/commonapi/getUserLoginId",
    { encryptedPayload: encryptRequest(JSON.stringify(payload)) },
    { skipAuth: true, cookie }
  );

  if (response.status !== 200) {
    throw new Error(
      `getUserLoginId failed (${response.status}): ${response.body.toString("utf8").slice(0, 200)}`
    );
  }

  let decrypted;
  try {
    decrypted = parseEncryptedApiResponse(response.body.toString("utf8"));
  } catch (err) {
    throw new Error(`getUserLoginId response parse failed: ${err.message}`);
  }

  const timeOutSpan = extractTimeOutSpan(response, decrypted);
  if (!timeOutSpan) {
    throw new Error(
      `getUserLoginId did not return timeOutSpan. Keys: ${Object.keys(decrypted || {}).join(", ")}`
    );
  }

  return { timeOutSpan, decrypted, response };
}

async function callAuthFbo(timeOutSpan, cookie, loginId) {
  const { password, md5Password } = resolveLoginSecrets();
  const ipAddress = env.fssaiIpAddress || (await fetchPublicIpAddress());
  const loginPayload = {
    username: loginId || env.fssaiUsername,
    password,
    md5Password,
    ipAddress,
    domainName: "foscos.fssai.gov.in",
    macAddress: "",
  };

  const response = await foscosRequest(
    "POST",
    "/gateway/authFbo",
    { encryptedPayload: encryptRequest(JSON.stringify(loginPayload)) },
    {
      skipAuth: true,
      cookie,
      extraHeaders: { timeOutSpan },
    }
  );

  if (response.status !== 200) {
    const hint =
      response.status === 401 && !env.fssaiPlainPassword
        ? " Set FSSAI_PLAIN_PASSWORD in .env (your FSSAI login password)."
        : response.status === 401
          ? " Check FSSAI_PLAIN_PASSWORD and FSSAI_BASE_COOKIE csrf_token."
          : "";
    throw new Error(
      `authFbo failed (${response.status}): ${response.body.toString("utf8").slice(0, 200)}.${hint}`
    );
  }

  let decrypted;
  try {
    decrypted = parseEncryptedApiResponse(response.body.toString("utf8"));
  } catch (err) {
    throw new Error(`authFbo response parse failed: ${err.message}`);
  }

  const bearerToken = extractBearerToken(decrypted, response.headers);
  if (!bearerToken) {
    throw new Error(
      `authFbo did not return bearer token. Keys: ${Object.keys(decrypted || {}).join(", ")}`
    );
  }

  const xAuthUserId = extractXAuthUserId(decrypted, response.headers);
  const mergedCookie = mergeSetCookies(cookie, response.headers["set-cookie"]);

  return { bearerToken, xAuthUserId, cookie: mergedCookie, decrypted, response };
}

async function refreshFssaiAuth(force = false) {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const now = Date.now();
  if (!force && now - lastRefreshAttemptAt < REFRESH_DEBOUNCE_MS) {
    throw new Error("Auth refresh debounced — try again shortly");
  }

  lastRefreshAttemptAt = now;

  refreshInFlight = (async () => {
    validateLoginConfig();
    console.log("[auth] Refreshing FSSAI credentials...");

    const loginCookie = await prepareLoginCookie();
    const step1 = await callGetUserLoginId(loginCookie);
    console.log("[auth] getUserLoginId OK");

    const step1Cookie = mergeSetCookies(
      loginCookie,
      step1.response.headers["set-cookie"]
    );
    const step2 = await callAuthFbo(
      step1.timeOutSpan,
      step1Cookie,
      step1.decrypted?.loginId
    );
    console.log("[auth] authFbo OK");

    const updates = {
      bearerToken: step2.bearerToken,
      cookie: step2.cookie,
      lastAuthRefreshAt: new Date(),
      authRefreshError: null,
    };

    if (step2.xAuthUserId) {
      updates.xAuthUserId = step2.xAuthUserId;
    }

    await updateCredentials(updates);
    console.log("[auth] Credentials updated successfully");

    return {
      ok: true,
      lastAuthRefreshAt: updates.lastAuthRefreshAt,
      expiresAt: getCredentials().credentialsExpireAt,
    };
  })();

  try {
    return await refreshInFlight;
  } catch (error) {
    await updateCredentials({
      authRefreshError: error.message,
      lastAuthRefreshAt: new Date(),
    });
    console.error("[auth] Refresh failed:", error.message);
    throw error;
  } finally {
    refreshInFlight = null;
  }
}

function isAutoRefreshConfigured() {
  try {
    validateLoginConfig();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  refreshFssaiAuth,
  isAutoRefreshConfigured,
};

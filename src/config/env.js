require("dotenv").config();

function normalizeOrigin(url) {
  if (!url) return "";
  return url.trim().replace(/\/+$/, "");
}

const clientUrls = (process.env.CLIENT_URL || "http://localhost:5174")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const env = {
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/fssai",
  bearerToken: process.env.BEARER_TOKEN || "",
  cookie: process.env.COOKIE || "",
  xAuthUserId: process.env.X_AUTH_USER_ID || "",
  fssaiUsername: process.env.FSSAI_USERNAME || "",
  fssaiPlainPassword: (process.env.FSSAI_PLAIN_PASSWORD || "").trim(),
  fssaiPasswordEncrypted: process.env.FSSAI_PASSWORD_ENCRYPTED || "",
  fssaiMd5Password: process.env.FSSAI_MD5_PASSWORD || "",
  fssaiDisplayRefId: process.env.FSSAI_DISPLAY_REF_ID || "",
  fssaiBaseCookie: process.env.FSSAI_BASE_COOKIE || process.env.COOKIE || "",
  fssaiIpAddress: process.env.FSSAI_IP_ADDRESS || "152.56.135.197",
  authRefreshOn401: process.env.AUTH_REFRESH_ON_401 !== "false",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  downloadAppPassword: process.env.DOWNLOAD_APP_PASSWORD || "admin123",
  port: parseInt(process.env.PORT || "4001", 10),
  clientUrls,
  isProduction: process.env.NODE_ENV === "production",
};

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return env.clientUrls.includes(normalizeOrigin(origin));
}

module.exports = { env, normalizeOrigin, isAllowedOrigin };

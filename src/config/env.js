require("dotenv").config();

const env = {
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/fssai",
  bearerToken: process.env.BEARER_TOKEN || "",
  cookie: process.env.COOKIE || "",
  xAuthUserId: process.env.X_AUTH_USER_ID || "",
  fssaiBaseCookie: process.env.FSSAI_BASE_COOKIE || process.env.COOKIE || "",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  downloadAppPassword: process.env.DOWNLOAD_APP_PASSWORD || "admin123",
  port: parseInt(process.env.PORT || "4001", 10),
  clientUrl: process.env.CLIENT_URL || "https://dataextractvalue.netlify.app/",
};

module.exports = { env };

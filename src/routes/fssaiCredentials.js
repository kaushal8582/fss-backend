const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const {
  getTokenExpiryWarning,
  updateCredentials,
  getCredentials,
} = require("../services/authCredentials");

const router = express.Router();

router.get("/status", authMiddleware, (_req, res) => {
  const tokenHealth = getTokenExpiryWarning();
  const creds = getCredentials();
  res.json({
    tokenHealth,
    hasBearerToken: Boolean(creds.bearerToken),
    hasXAuthUserId: Boolean(creds.xAuthUserId),
    hasCookie: Boolean(creds.cookie),
    credentialsExpireAt: creds.credentialsExpireAt,
  });
});

router.put("/credentials", authMiddleware, async (req, res) => {
  const { bearerToken, xAuthUserId, cookie } = req.body || {};

  if (!bearerToken?.trim()) {
    return res.status(400).json({ error: "bearerToken is required" });
  }

  const updates = { bearerToken: bearerToken.trim() };
  if (xAuthUserId !== undefined) {
    updates.xAuthUserId = String(xAuthUserId).trim();
  }
  if (cookie !== undefined) {
    updates.cookie = String(cookie).trim();
  }

  try {
    const creds = await updateCredentials(updates);
    const tokenHealth = getTokenExpiryWarning();
    res.json({
      ok: true,
      tokenHealth,
      hasBearerToken: Boolean(creds.bearerToken),
      hasXAuthUserId: Boolean(creds.xAuthUserId),
      hasCookie: Boolean(creds.cookie),
      cookieRecommended: !creds.cookie,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

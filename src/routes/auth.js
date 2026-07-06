const express = require("express");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const router = express.Router();

function extractToken(req) {
  return (
    req.cookies?.token ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null)
  );
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

router.post("/login", async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  if (password !== env.downloadAppPassword) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const token = jwt.sign({ role: "download" }, env.jwtSecret, { expiresIn: "7d" });

  res.cookie("token", token, cookieOptions());

  // Return token in body for cross-origin clients (Netlify + Render)
  res.json({ ok: true, token });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token", cookieOptions());
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    jwt.verify(token, env.jwtSecret);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: "Not authenticated" });
  }
});

module.exports = router;

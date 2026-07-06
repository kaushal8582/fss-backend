const express = require("express");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }

  if (password !== env.downloadAppPassword) {
    return res.status(401).json({ error: "Invalid password" });
  }

  const token = jwt.sign({ role: "download" }, env.jwtSecret, { expiresIn: "7d" });

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ ok: true });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  const token = req.cookies?.token;
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

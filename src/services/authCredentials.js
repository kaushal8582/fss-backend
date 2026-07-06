const mongoose = require("mongoose");
const { env } = require("../config/env");
const AuthState = require("../models/AuthState");

function normalizeBearerToken(token) {
  if (!token) return "";
  const trimmed = token.trim();
  return trimmed.startsWith("Bearer ") ? trimmed.slice(7) : trimmed;
}

function getTokenExpMs(token) {
  try {
    const normalized = normalizeBearerToken(token);
    const payload = JSON.parse(
      Buffer.from(normalized.split(".")[1], "base64url").toString("utf8")
    );
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

let credentials = {
  bearerToken: normalizeBearerToken(env.bearerToken),
  cookie: env.cookie || env.fssaiBaseCookie,
  xAuthUserId: env.xAuthUserId,
  lastAuthRefreshAt: null,
  authRefreshError: null,
  credentialsExpireAt: null,
};

function getBearerExpiry(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    return payload.exp ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}

function getCredentials() {
  return { ...credentials };
}

function getTokenExpiryWarning() {
  const token = credentials.bearerToken;
  if (!token) {
    return { expired: true, message: "FSSAI bearer token is not set" };
  }
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    const exp = payload.exp * 1000;
    const now = Date.now();
    const hoursLeft = (exp - now) / (1000 * 60 * 60);
    if (hoursLeft <= 0) {
      return { expired: true, message: "FSSAI bearer token has expired" };
    }
    if (hoursLeft <= 6) {
      return {
        expired: false,
        warning: true,
        message: `FSSAI bearer token expires in ${hoursLeft.toFixed(1)} hours`,
        expiresAt: new Date(exp).toISOString(),
      };
    }
    return {
      expired: false,
      warning: false,
      expiresAt: new Date(exp).toISOString(),
    };
  } catch {
    return { expired: false, warning: true, message: "Could not parse bearer token expiry" };
  }
}

async function loadFromDb() {
  try {
    const state = await AuthState.findById("auth_state");
    const envBearer = normalizeBearerToken(env.bearerToken);
    const envExp = getTokenExpMs(envBearer);
    const dbExp = state?.bearerToken ? getTokenExpMs(state.bearerToken) : 0;

    if (envBearer && envExp >= dbExp) {
      credentials = {
        bearerToken: envBearer,
        cookie: env.cookie || env.fssaiBaseCookie || credentials.cookie,
        xAuthUserId: env.xAuthUserId || credentials.xAuthUserId,
        lastAuthRefreshAt: state?.lastAuthRefreshAt || null,
        authRefreshError: null,
        credentialsExpireAt: getBearerExpiry(envBearer),
      };
      await persistCredentials();
      console.log("[auth] Using credentials from .env (newer or preferred)");
      return;
    }

    if (!state || !state.bearerToken) {
      return;
    }

    credentials = {
      bearerToken: normalizeBearerToken(state.bearerToken),
      cookie: state.cookie || credentials.cookie,
      xAuthUserId: state.xAuthUserId || credentials.xAuthUserId,
      lastAuthRefreshAt: state.lastAuthRefreshAt,
      authRefreshError: state.authRefreshError,
      credentialsExpireAt: state.credentialsExpireAt,
    };
    console.log("[auth] Loaded credentials from database");
  } catch (err) {
    console.warn("[auth] Could not load credentials from database:", err.message);
  }
}

async function persistCredentials() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  await AuthState.findByIdAndUpdate(
    "auth_state",
    {
      bearerToken: credentials.bearerToken,
      cookie: credentials.cookie,
      xAuthUserId: credentials.xAuthUserId,
      lastAuthRefreshAt: credentials.lastAuthRefreshAt,
      authRefreshError: credentials.authRefreshError,
      credentialsExpireAt: credentials.credentialsExpireAt,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function updateCredentials(updates) {
  if (updates.bearerToken !== undefined) {
    credentials.bearerToken = normalizeBearerToken(updates.bearerToken);
    credentials.credentialsExpireAt = getBearerExpiry(credentials.bearerToken);
  }
  if (updates.cookie !== undefined) {
    credentials.cookie = updates.cookie;
  }
  if (updates.xAuthUserId !== undefined) {
    credentials.xAuthUserId = updates.xAuthUserId;
  }
  if (updates.lastAuthRefreshAt !== undefined) {
    credentials.lastAuthRefreshAt = updates.lastAuthRefreshAt;
  }
  if (updates.authRefreshError !== undefined) {
    credentials.authRefreshError = updates.authRefreshError;
  }

  try {
    if (mongoose.connection.readyState !== 1) {
      return getCredentials();
    }
    await persistCredentials();
  } catch (err) {
    console.warn("[auth] Could not persist credentials:", err.message);
  }

  return getCredentials();
}

module.exports = {
  getCredentials,
  getTokenExpiryWarning,
  loadFromDb,
  updateCredentials,
};

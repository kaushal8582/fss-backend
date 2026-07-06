const mongoose = require("mongoose");

const authStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "auth_state" },
    bearerToken: { type: String, default: "" },
    cookie: { type: String, default: "" },
    xAuthUserId: { type: String, default: "" },
    lastAuthRefreshAt: { type: Date, default: null },
    authRefreshError: { type: String, default: null },
    credentialsExpireAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuthState", authStateSchema);

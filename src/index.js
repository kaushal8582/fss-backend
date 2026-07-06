const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { connectDb } = require("./db/mongoose");
const { env } = require("./config/env");
const { loadFromDb } = require("./services/authCredentials");
const authRoutes = require("./routes/auth");
const downloadRoutes = require("./routes/download");
const fssaiCredentialsRoutes = require("./routes/fssaiCredentials");

const app = express();

app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/download", downloadRoutes);
app.use("/api/fssai", fssaiCredentialsRoutes);

async function start() {
  await connectDb();
  await loadFromDb();
  app.listen(env.port, () => {
    console.log(`Download server running on http://localhost:${env.port}`);
  });
}

start().catch((err) => {
  console.error("Failed to start download server:", err);
  process.exit(1);
});

const mongoose = require("mongoose");
const { env } = require("../config/env");

async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongodbUri);
  console.log("Connected to MongoDB");
}

module.exports = { connectDb };

import "dotenv/config";
import "./config/env.js";
import http from "node:http";
import mongoose from "mongoose";
import app from "./app.js";

const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

mongoose
  .connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || "footfall" })
  .then(() => {
    console.log("DB connected");
    server.listen(PORT, () => console.log(`Server running on ${PORT}`));
  })
  .catch((err) => {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  });

import path from "node:path";
import dotenv from "dotenv";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { createStore } from "./lib/supabase";

dotenv.config({ path: ".env.local", quiet: true });
const config = loadConfig(process.env);
createApp({
  store: createStore(config.database),
  diagnosticToken: config.diagnosticToken,
  staticPath: path.resolve("dist/public"),
}).listen(config.port, "127.0.0.1", () =>
  console.log(`AURA API listening on loopback:${config.port}`)
);

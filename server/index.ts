import path from "node:path";
import { serverEnvironment } from "./environment";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { createStore } from "./lib/supabase";

const config = loadConfig(serverEnvironment(process.cwd()));
createApp({
  store: createStore(config.database),
  diagnosticToken: config.diagnosticToken,
  staticPath: path.resolve("dist/public"),
}).listen(config.port, "127.0.0.1", () =>
  console.log(`AURA API listening on loopback:${config.port}`)
);

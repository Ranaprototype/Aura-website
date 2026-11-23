import path from "node:path";
import { serverEnvironment } from "./environment";
import { loadConfig } from "./config";
import { createApp } from "./app";
import { createStore } from "./lib/supabase";
import { createServices } from "./services";

const config = loadConfig(serverEnvironment(process.cwd()));
const services = createServices(config, {
  appOrigin: config.appOrigin ?? `http://127.0.0.1:${config.port}`,
});
const server = createApp({
  store: createStore(config.database),
  diagnosticToken: config.diagnosticToken,
  staticPath: path.resolve("dist/public"),
  services,
}).listen(config.port, "127.0.0.1", () =>
  console.log(`AURA API listening on loopback:${config.port}`)
);

const shutdown = () => {
  server.close(() => {
    void services?.close().finally(() => process.exit(0));
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

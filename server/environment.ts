import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

// Server/tooling only. Do not export this environment to a browser bundle.
export function serverEnvironment(
  root: string,
  shell: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  let file: Record<string, string> = {};
  try {
    file = parse(readFileSync(path.join(root, ".env.local")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { ...file, ...shell };
}
export function apiPort(value: string | undefined): number {
  if (value === undefined) return 3001;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
    throw new Error("Invalid API port");
  return Number(value);
}

/**
 * Shared Chromium launch for the browser suites.
 *
 * The suites must run unchanged on a developer machine, in a constrained
 * container and on a GitHub runner. Rather than baking one set of flags into
 * every test, try the portable flag set first, fall back to the flags a
 * sandboxed container needs, and finally to Playwright's own defaults. Each
 * attempt is verified by rendering a page, so a browser that starts but cannot
 * paint is rejected instead of failing later inside a test.
 *
 * A failure is reported twice: as a normal error, and as a GitHub annotation
 * (`::error::`) so the reason is visible on a failed CI run without log access.
 */
import { chromium, type Browser } from "playwright-core";

const portable = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
];

/** Flags required by containers without namespaces/GPU (CI sandboxes, Lambda). */
const constrained = [
  ...portable,
  "--no-zygote",
  "--single-process",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

export const chromiumExecutable = async (): Promise<string> => {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const module = await import("@sparticuz/chromium");
  const path = await module.default.executablePath();
  if (!path) throw new Error("A Chromium executable is required; set CHROMIUM_PATH.");
  return path;
};

const summarise = (error: unknown) => {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return text.split("\n").slice(0, 3).join(" ").slice(0, 400);
};

const attempt = async (executablePath: string, args?: string[]): Promise<Browser> => {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    ...(args ? { args } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent("<h1 id='probe'>ready</h1>");
    const text = await page.textContent("#probe");
    await page.close();
    if (text !== "ready") throw new Error(`probe page rendered ${JSON.stringify(text)}`);
    return browser;
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
};

export const launchChromium = async (executablePath?: string): Promise<Browser> => {
  const path = executablePath ?? (await chromiumExecutable());
  const modes: Array<[string, string[] | undefined]> = [
    ["portable flags", portable],
    ["container flags", constrained],
    ["playwright defaults", undefined],
  ];
  const failures: string[] = [];
  for (const [name, args] of modes) {
    try {
      return await attempt(path, args);
    } catch (error) {
      failures.push(`${name} → ${summarise(error)}`);
    }
  }
  const message = `Chromium could not start with ${path}: ${failures.join(" | ")}`;
  console.error(`::error::${message}`);
  throw new Error(message);
};

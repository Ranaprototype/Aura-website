/**
 * Email notification verification: all seven templates, real local SMTP
 * delivery, permanent and transient failures, retries, idempotency, duplicate
 * suppression, rate limiting and the static "no secrets in source" checks.
 *
 * The SMTP sink listens on loopback only and relays nothing.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EmailService, PgEmailStore, type EmailTransport } from "../server/email/service";
import { createSmtpTransport } from "../server/email/transport";
import {
  normalizeRecipient,
  renderEmail,
  templateNames,
  type TemplateData,
  type EmailTemplateName,
} from "../server/email/templates";
import { createLogger } from "../server/http/logger";
import { startSmtpSink } from "./support/smtp";
import { startTestApp, type TestApp } from "./support/app";

let app: TestApp;

const sampleData: { [Name in EmailTemplateName]: TemplateData<Name> } = {
  welcome: {
    name: "Ada <script>",
    orgName: "Ada & Co",
    appUrl: "http://127.0.0.1:43001/workspace",
  },
  "verify-email": {
    name: "Ada",
    verifyUrl: "http://127.0.0.1:43001/verify-email?token=abcdefghijklmnopqrstuvwxyz",
    expiresInMinutes: 60,
  },
  "password-reset": {
    name: "Ada",
    resetUrl: "http://127.0.0.1:43001/reset-password?token=abcdefghijklmnopqrstuvwxyz",
    expiresInMinutes: 60,
  },
  invitation: {
    inviterName: "Grace",
    orgName: "Tenant A",
    role: "member",
    acceptUrl: "http://127.0.0.1:43001/accept-invitation?token=abcdefghijklmnopqrstuvwxyz",
    expiresInDays: 7,
  },
  "membership-revoked": {
    orgName: "Tenant A",
    actorName: "Grace",
    appUrl: "http://127.0.0.1:43001/workspace",
  },
  "role-changed": {
    orgName: "Tenant A",
    previousRole: "member",
    newRole: "admin",
    actorName: "Grace",
    appUrl: "http://127.0.0.1:43001/workspace",
  },
  "security-alert": {
    name: "Ada",
    detail: "Your password was reset.",
    occurredAt: "2026-11-22T00:00:00.000Z",
    appUrl: "http://127.0.0.1:43001/workspace",
  },
};

const serviceFor = (
  options: {
    transport?: EmailTransport;
    templateDailyLimit?: number;
    recipientHourlyLimit?: number;
    maxAttempts?: number;
    logs?: Array<Record<string, string | number | boolean>>;
  } = {}
) => {
  const logs = options.logs ?? app.logs;
  return new EmailService({
    store: new PgEmailStore(app.db.db),
    transport:
      options.transport ??
      createSmtpTransport({ url: app.sink.url, from: "AURA <no-reply@aura.test>" }),
    logger: createLogger(entry => logs.push(entry)),
    maxAttempts: options.maxAttempts ?? 3,
    templateDailyLimit: options.templateDailyLimit ?? 10,
    recipientHourlyLimit: options.recipientHourlyLimit ?? 20,
    sleep: async () => {},
  });
};

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

const ledger = (recipient: string) =>
  app.db.db.query<{ status: string; attempts: number; last_error: string | null; id: string }>(
    `select status, attempts, last_error, id from aura.email_events where recipient = $1
      order by created_at`,
    [recipient]
  );

describe("template rendering", () => {
  it("ships exactly the seven required templates", () => {
    expect([...templateNames].sort()).toEqual([
      "invitation",
      "membership-revoked",
      "password-reset",
      "role-changed",
      "security-alert",
      "verify-email",
      "welcome",
    ]);
  });

  it.each(templateNames)("renders HTML and plain text for %s", template => {
    const rendered = renderEmail(template, sampleData[template] as never);
    expect(rendered.subject.length).toBeGreaterThan(5);
    expect(rendered.html).toMatch(/^<!doctype html>/i);
    expect(rendered.html).toContain("<h1");
    expect(rendered.text.length).toBeGreaterThan(20);
    // Text alternative has no markup and no hidden tracking pixel.
    expect(rendered.text).not.toMatch(/<(?:html|body|table|a\s|img|h1)/i);
    expect(rendered.html).not.toMatch(/<img|tracking|pixel/i);
    // The two renderings carry the same amount of information.
    expect(rendered.text.split("\n").length).toBeGreaterThan(2);
  });

  it("escapes interpolated values in HTML and strips control characters", () => {
    const rendered = renderEmail("welcome", sampleData.welcome);
    expect(rendered.html).toContain("Ada &lt;script&gt;");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("Ada &amp; Co");
    const hostile = renderEmail("security-alert", {
      ...sampleData["security-alert"],
      detail: "line\u0000break\r\nBcc: attacker@example.test",
    });
    expect(hostile.html).not.toContain("\u0000");
    expect(hostile.text).not.toContain("\r");
  });

  it("contains the action link exactly once per message", () => {
    const rendered = renderEmail("password-reset", sampleData["password-reset"]);
    const occurrences = rendered.html.split(sampleData["password-reset"].resetUrl).length - 1;
    expect(occurrences).toBe(2); // button href and the plain fallback
    expect(rendered.text).toContain(sampleData["password-reset"].resetUrl);
  });
});

describe("recipient validation", () => {
  it.each([
    ["not-an-email", undefined],
    ["a@b", undefined],
    ["user@example.test\r\nBcc: victim@example.test", undefined],
    ["", undefined],
    ["user@example.test", "user@example.test"],
    ["  USER@Example.Test  ", "user@example.test"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeRecipient(input)).toBe(expected);
  });

  it("refuses an invalid recipient without storing or delivering anything", async () => {
    const service = serviceFor();
    const before = app.sink.messages.length;
    const result = await service.send({
      template: "welcome",
      to: "victim@example.test\r\nBcc: other@example.test",
      data: sampleData.welcome,
      idempotencyKey: "invalid-recipient-check",
    });
    expect(result.status).toBe("invalid_recipient");
    expect(app.sink.messages.length).toBe(before);
    expect(
      await app.db.db.query(`select id from aura.email_events where idempotency_key = $1`, [
        "invalid-recipient-check",
      ])
    ).toEqual([]);
  });
});

describe("local delivery over SMTP", () => {
  it.each(templateNames)("delivers %s to the local sink", async template => {
    const service = serviceFor();
    const recipient = `delivery-${template}@example.test`;
    const result = await service.send({
      template,
      to: recipient,
      data: sampleData[template] as never,
      idempotencyKey: `delivery:${template}`,
    });
    expect(result.status).toBe("sent");
    expect(result.attempts).toBe(1);

    const message = app.sink.messages.find(entry => entry.to.includes(recipient));
    expect(message).toBeDefined();
    expect(message?.subject).toBeTruthy();
    expect(message?.header("X-AURA-Template")).toBe(template);
    expect(message?.html ?? "").toContain("<html");
    expect(message?.text ?? "").toContain(
      // every template body mentions the recipient-visible action or fact
      template === "verify-email" ? "Confirm your AURA email address" : ""
    );
    expect(await ledger(recipient)).toMatchObject([{ status: "sent", attempts: 1 }]);
  });

  it("never stores the message body in the delivery ledger", async () => {
    const columns = await app.db.admin.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'aura' and table_name = 'email_events'`
    );
    const names = columns.map(column => column.column_name);
    expect(names).not.toContain("body");
    expect(names).not.toContain("token");
    expect(names).not.toContain("html");
  });
});

describe("failure handling", () => {
  it("stops retrying a permanent 5xx rejection and records the failure", async () => {
    const rejecting = await startSmtpSink({ rejectRecipient: () => 550 });
    try {
      const service = new EmailService({
        store: new PgEmailStore(app.db.db),
        transport: createSmtpTransport({
          url: rejecting.url,
          from: "AURA <no-reply@aura.test>",
        }),
        logger: createLogger(entry => app.logs.push(entry)),
        sleep: async () => {},
      });
      const recipient = "rejected@example.test";
      const result = await service.send({
        template: "invitation",
        to: recipient,
        data: sampleData.invitation,
        idempotencyKey: "permanent-failure",
      });
      expect(result.status).toBe("failed");
      expect(result.attempts).toBe(1);
      expect(rejecting.messages).toHaveLength(0);
      expect(await ledger(recipient)).toMatchObject([
        { status: "failed", attempts: 1, last_error: "smtp_550" },
      ]);
    } finally {
      await rejecting.close();
    }
  });

  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const flaky: EmailTransport = {
      async send() {
        calls += 1;
        if (calls < 3) throw Object.assign(new Error("temporary"), { responseCode: 451 });
        return { id: "flaky-1" };
      },
    };
    const service = serviceFor({ transport: flaky });
    const result = await service.send({
      template: "welcome",
      to: "flaky@example.test",
      data: sampleData.welcome,
      idempotencyKey: "transient-then-success",
    });
    expect(result.status).toBe("sent");
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("gives up after the configured attempts and records the last error", async () => {
    let calls = 0;
    const alwaysDown: EmailTransport = {
      async send() {
        calls += 1;
        throw Object.assign(new Error("down"), { code: "ECONNECTION" });
      },
    };
    const service = serviceFor({ transport: alwaysDown, maxAttempts: 2 });
    const result = await service.send({
      template: "security-alert",
      to: "unreachable@example.test",
      data: sampleData["security-alert"],
      idempotencyKey: "retry-exhausted",
    });
    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(await ledger("unreachable@example.test")).toMatchObject([
      { status: "failed", attempts: 2, last_error: "econnection" },
    ]);
  });
});

describe("idempotency and duplicate suppression", () => {
  it("delivers once for a repeated idempotency key", async () => {
    const first = serviceFor();
    const second = serviceFor();
    const input = {
      template: "membership-revoked" as const,
      to: "twice@example.test",
      data: sampleData["membership-revoked"],
      idempotencyKey: "same-event-1",
    };
    const a = await first.send(input);
    const b = await second.send(input);
    expect(a.status).toBe("sent");
    expect(b.status).toBe("duplicate");
    const delivered = app.sink.messages.filter(message => message.to.includes("twice@example.test"));
    expect(delivered).toHaveLength(1);
    expect(await ledger("twice@example.test")).toHaveLength(1);
  });

  it("prevents concurrent duplicate sends from two workers", async () => {
    const input = {
      template: "role-changed" as const,
      to: "race@example.test",
      data: sampleData["role-changed"],
      idempotencyKey: "same-event-race",
    };
    const results = await Promise.all([serviceFor().send(input), serviceFor().send(input)]);
    expect(results.filter(result => result.status === "sent")).toHaveLength(1);
    expect(results.filter(result => result.status === "duplicate")).toHaveLength(1);
    expect(
      app.sink.messages.filter(message => message.to.includes("race@example.test"))
    ).toHaveLength(1);
  });

  it("rejects a malformed idempotency key", async () => {
    await expect(
      serviceFor().send({
        template: "welcome",
        to: "key@example.test",
        data: sampleData.welcome,
        idempotencyKey: "",
      })
    ).rejects.toThrow(/idempotency/i);
  });
});

describe("rate limiting", () => {
  it("suppresses messages beyond the per-template daily ceiling", async () => {
    const service = serviceFor({ templateDailyLimit: 2 });
    const recipient = "limited@example.test";
    const results = [];
    for (let index = 0; index < 3; index += 1) {
      results.push(
        await service.send({
          template: "password-reset",
          to: recipient,
          data: sampleData["password-reset"],
          idempotencyKey: `rate-limit-${index}`,
        })
      );
    }
    expect(results.map(result => result.status)).toEqual(["sent", "sent", "suppressed"]);
    expect(await ledger(recipient)).toMatchObject([
      { status: "sent" },
      { status: "sent" },
      { status: "suppressed", attempts: 0 },
    ]);
  });

  it("enforces a ceiling across templates for one recipient", async () => {
    const service = serviceFor({ templateDailyLimit: 100, recipientHourlyLimit: 1 });
    const recipient = "hourly@example.test";
    const first = await service.send({
      template: "welcome",
      to: recipient,
      data: sampleData.welcome,
      idempotencyKey: "hourly-1",
    });
    const second = await service.send({
      template: "verify-email",
      to: recipient,
      data: sampleData["verify-email"],
      idempotencyKey: "hourly-2",
    });
    expect(first.status).toBe("sent");
    expect(second.status).toBe("suppressed");
  });
});

describe("logs and source hygiene", () => {
  it("never writes a recipient, a token or a message body to the log", async () => {
    const logs: Array<Record<string, string | number | boolean>> = [];
    const service = serviceFor({ logs });
    await service.send({
      template: "password-reset",
      to: "log-check@example.test",
      data: {
        ...sampleData["password-reset"],
        resetUrl: "http://127.0.0.1:43001/reset-password?token=SECRETTOKENVALUE123456",
      },
      idempotencyKey: "log-check",
    });
    await service.send({
      template: "password-reset",
      to: "not-an-email",
      data: sampleData["password-reset"],
      idempotencyKey: "log-check-2",
    });
    expect(logs.length).toBeGreaterThan(0);
    for (const entry of logs) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toMatch(/log-check@example|SECRETTOKENVALUE|reset-password/);
      expect(Object.keys(entry).every(key =>
        ["event", "level", "template", "attempt", "code", "result", "count", "status"].includes(key)
      )).toBe(true);
    }
  });

  it("stores no SMTP credential, password or webhook secret in the repository", async () => {
    const roots = ["server", "client/src", "shared", "supabase"];
    const files: string[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else files.push(full);
      }
    };
    for (const root of roots) await walk(root);
    expect(files.length).toBeGreaterThan(30);

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      // A credential embedded in a smtp:// URL, e.g. smtp://user:password@host
      expect(contents, file).not.toMatch(/smtps?:\/\/[^\s"'`/@]+:[^\s"'`/@]+@/i);
      expect(contents, file).not.toMatch(/nodemailer\.createTransport\(\s*["'`]/);
      expect(contents, file).not.toMatch(/pass(?:word)?\s*:\s*["'`]/i);
      expect(contents, file).not.toMatch(/SERVICE_ROLE|service_role_key/i);
    }

    const example = await readFile(".env.example", "utf8");
    expect(example).not.toMatch(/:[A-Za-z0-9._-]{6,}@/);
    expect(example).toContain("<password>");
    expect(example).toMatch(/SMTP_URL/);
  });

  it("reads the SMTP transport only from configuration", async () => {
    const config = await readFile("server/config.ts", "utf8");
    expect(config).toMatch(/SMTP_URL/);
    const transport = await readFile("server/email/transport.ts", "utf8");
    expect(transport).not.toMatch(/pass(?:word)?\s*:/i);
    expect(transport).not.toMatch(/auth:\s*\{\s*user/);
  });

  it("refuses a non-SMTP transport URL", () => {
    expect(() =>
      createSmtpTransport({ url: "http://127.0.0.1:2525", from: "a@b.test" })
    ).toThrow(/Invalid SMTP transport/);
  });
});

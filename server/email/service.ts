import type { Database } from "../db/database";
import type { Logger } from "../http/logger";
import {
  normalizeRecipient,
  renderEmailDynamic,
  type EmailTemplateName,
} from "./templates";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: EmailTemplateName;
}

export interface EmailTransport {
  send(message: OutgoingEmail): Promise<{ id: string }>;
  close?(): void | Promise<void>;
}

export interface EmailEventRecord {
  id: string;
  claimed: boolean;
}

export interface EmailStore {
  claim(input: {
    idempotencyKey: string;
    template: EmailTemplateName;
    recipient: string;
  }): Promise<EmailEventRecord>;
  hitRateLimit(bucket: string, windowSeconds: number, limit: number): Promise<number>;
  recordAttempt(id: string, attempts: number, error?: string): Promise<void>;
  markSent(id: string, messageId: string, attempts: number): Promise<void>;
  markFailed(id: string, error: string, attempts: number): Promise<void>;
  markSuppressed(id: string, reason: string): Promise<void>;
}

export type SendStatus =
  | "sent"
  | "duplicate"
  | "suppressed"
  | "invalid_recipient"
  | "failed";

export interface SendResult {
  status: SendStatus;
  template: EmailTemplateName;
  attempts: number;
  eventId?: string;
  providerMessageId?: string;
  reason?: string;
}

export interface EmailServiceOptions {
  store: EmailStore;
  transport: EmailTransport;
  logger: Logger;
  maxAttempts?: number;
  /** Per-recipient hourly ceiling across all templates. */
  recipientHourlyLimit?: number;
  /** Per-template daily ceiling for one recipient. */
  templateDailyLimit?: number;
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const sleepDefault = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/** Reduces a transport failure to a stable, non-sensitive code. */
export function sanitizeDeliveryError(error: unknown): string {
  const candidate = error as { responseCode?: unknown; code?: unknown } | undefined;
  const responseCode = Number(candidate?.responseCode);
  if (Number.isFinite(responseCode) && responseCode >= 100)
    return `smtp_${Math.trunc(responseCode)}`;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  if (/^(?:E[A-Z]+|ESOCKET|ETIMEDOUT)$/.test(code)) return code.toLowerCase();
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return "delivery_error";
}

/** 4xx and connection failures may succeed on retry; 5xx and address errors may not. */
export function isRetryableDeliveryError(error: unknown): boolean {
  const candidate = error as { responseCode?: unknown; code?: unknown } | undefined;
  const responseCode = Number(candidate?.responseCode);
  if (Number.isFinite(responseCode) && responseCode >= 100)
    return responseCode >= 400 && responseCode < 500;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  if (code === "EENVELOPE") return false;
  return true;
}

export class EmailService {
  private readonly store: EmailStore;
  private readonly transport: EmailTransport;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly recipientHourlyLimit: number;
  private readonly templateDailyLimit: number;
  private readonly backoffMs: number[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EmailServiceOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.logger = options.logger;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.recipientHourlyLimit = options.recipientHourlyLimit ?? 20;
    this.templateDailyLimit = options.templateDailyLimit ?? 10;
    this.backoffMs = options.backoffMs ?? [50, 150];
    this.sleep = options.sleep ?? sleepDefault;
  }

  async send({
    template,
    to,
    data,
    idempotencyKey,
  }: {
    template: EmailTemplateName;
    to: unknown;
    data: unknown;
    idempotencyKey: string;
  }): Promise<SendResult> {
    const recipient = normalizeRecipient(to);
    if (!recipient) {
      // Nothing is stored for a malformed address, so a probe cannot fill the
      // audit table with arbitrary strings.
      this.logger.warn("email_recipient_invalid", { template, code: "invalid_recipient" });
      return { status: "invalid_recipient", template, attempts: 0 };
    }
    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < 4 ||
      idempotencyKey.length > 200
    )
      throw new Error("Invalid idempotency key");

    const claim = await this.store.claim({ idempotencyKey, template, recipient });
    if (!claim.claimed) {
      this.logger.info("email_duplicate_suppressed", { template });
      return { status: "duplicate", template, attempts: 0, eventId: claim.id };
    }

    const recipientHits = await this.store.hitRateLimit(
      `email:recipient:${recipient}`,
      3600,
      this.recipientHourlyLimit
    );
    const templateHits = await this.store.hitRateLimit(
      `email:template:${template}:${recipient}`,
      86_400,
      this.templateDailyLimit
    );
    if (recipientHits > this.recipientHourlyLimit || templateHits > this.templateDailyLimit) {
      await this.store.markSuppressed(claim.id, "rate_limited");
      this.logger.warn("email_rate_limited", { template });
      return {
        status: "suppressed",
        template,
        attempts: 0,
        eventId: claim.id,
        reason: "rate_limited",
      };
    }

    const rendered = renderEmailDynamic(template, data);
    const message: OutgoingEmail = {
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template,
    };

    let attempts = 0;
    let lastError = "";
    while (attempts < this.maxAttempts) {
      attempts += 1;
      try {
        const info = await this.transport.send(message);
        await this.store.markSent(claim.id, info.id, attempts);
        this.logger.info("email_sent", { template, attempt: attempts });
        return {
          status: "sent",
          template,
          attempts,
          eventId: claim.id,
          providerMessageId: info.id,
        };
      } catch (error) {
        lastError = sanitizeDeliveryError(error);
        await this.store.recordAttempt(claim.id, attempts, lastError);
        this.logger.warn("email_delivery_failed", {
          template,
          attempt: attempts,
          code: lastError,
        });
        if (!isRetryableDeliveryError(error)) break;
        if (attempts < this.maxAttempts)
          await this.sleep(this.backoffMs[attempts - 1] ?? this.backoffMs.at(-1) ?? 100);
      }
    }

    await this.store.markFailed(claim.id, lastError, attempts);
    this.logger.error("email_failed", { template, attempt: attempts, code: lastError });
    return {
      status: "failed",
      template,
      attempts,
      eventId: claim.id,
      reason: lastError,
    };
  }

  async close() {
    await this.transport.close?.();
  }
}

/** PostgreSQL-backed delivery ledger, rate counters and idempotency claims. */
export class PgEmailStore implements EmailStore {
  constructor(private readonly db: Database) {}

  async claim({
    idempotencyKey,
    template,
    recipient,
  }: {
    idempotencyKey: string;
    template: EmailTemplateName;
    recipient: string;
  }): Promise<EmailEventRecord> {
    const inserted = await this.db.query<{ id: string }>(
      `insert into aura.email_events (idempotency_key, template, recipient)
       values ($1, $2, $3)
       on conflict (idempotency_key) do nothing
       returning id`,
      [idempotencyKey, template, recipient]
    );
    if (inserted[0]) return { id: inserted[0].id, claimed: true };
    const existing = await this.db.query<{ id: string }>(
      `select id from aura.email_events where idempotency_key = $1`,
      [idempotencyKey]
    );
    if (!existing[0]) throw new Error("Email ledger unavailable");
    return { id: existing[0].id, claimed: false };
  }

  async hitRateLimit(bucket: string, windowSeconds: number, limit: number) {
    const rows = await this.db.query<{ hits: number }>(
      `insert into aura.email_rate_limits (bucket, window_start, hits)
       values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
       on conflict (bucket, window_start)
         do update set hits = aura.email_rate_limits.hits + 1
       returning hits`,
      [bucket, windowSeconds]
    );
    const hits = Number(rows[0]?.hits ?? limit + 1);
    if (hits === 1)
      await this.db.query(
        `delete from aura.email_rate_limits
          where bucket = $1 and window_start < now() - interval '1 day'`,
        [bucket]
      );
    return hits;
  }

  async recordAttempt(id: string, attempts: number, error?: string) {
    await this.db.query(
      `update aura.email_events
          set attempts = $2, last_error = $3
        where id = $1`,
      [id, attempts, error ?? null]
    );
  }

  async markSent(id: string, messageId: string, attempts: number) {
    await this.db.query(
      `update aura.email_events
          set status = 'sent', sent_at = now(), provider_message_id = $2,
              attempts = $3, last_error = null
        where id = $1`,
      [id, messageId, attempts]
    );
  }

  async markFailed(id: string, error: string, attempts: number) {
    await this.db.query(
      `update aura.email_events
          set status = 'failed', attempts = $2, last_error = $3
        where id = $1`,
      [id, attempts, error]
    );
  }

  async markSuppressed(id: string, reason: string) {
    await this.db.query(
      `update aura.email_events
          set status = 'suppressed', last_error = $2
        where id = $1`,
      [id, reason]
    );
  }
}

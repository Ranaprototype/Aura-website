import nodemailer from "nodemailer";
import type { EmailTransport, OutgoingEmail } from "./service";

/**
 * SMTP transport. The URL (and therefore any username/password) comes from
 * server-side configuration only; it is never read from a request and never
 * serialized into a response.
 */
export function createSmtpTransport({
  url,
  from,
  timeoutMs = 5_000,
}: {
  url: string;
  from: string;
  timeoutMs?: number;
}): EmailTransport {
  const parsed = new URL(url);
  if (!["smtp:", "smtps:"].includes(parsed.protocol))
    throw new Error("Invalid SMTP transport");
  const transport = nodemailer.createTransport({
    url,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
  return {
    async send(message: OutgoingEmail) {
      const info = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { "X-AURA-Template": message.template },
      });
      return { id: String(info.messageId ?? `smtp-${Date.now()}`) };
    },
    async close() {
      transport.close();
    },
  };
}

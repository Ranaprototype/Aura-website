/**
 * Local SMTP sink used as the approved email testing service. It accepts mail
 * on loopback only, stores each message in memory and never relays it, so no
 * production email is sent and no third-party service is purchased.
 */
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";

export interface CapturedMessage {
  from: string;
  to: string[];
  raw: string;
  subject: string | undefined;
  html: string | undefined;
  text: string | undefined;
  header: (name: string) => string | undefined;
}

export interface LocalSmtpSink {
  url: string;
  messages: CapturedMessage[];
  /** Deliveries whose envelope recipient was rejected with a transient code. */
  transientFailures: number;
  reset(): void;
  close(): Promise<void>;
}

const decodeQuotedPrintable = (value: string) =>
  value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );

const decodeBody = (raw: string) => {
  const body = raw.slice(raw.indexOf("\r\n\r\n") + 4);
  if (/content-transfer-encoding:\s*quoted-printable/i.test(raw)) {
    try {
      return decodeQuotedPrintable(body);
    } catch {
      return body;
    }
  }
  return body;
};

export async function startSmtpSink({
  rejectRecipient,
}: { rejectRecipient?: (address: string) => number | false } = {}): Promise<LocalSmtpSink> {
  const messages: CapturedMessage[] = [];
  const state: { transientFailures: number } = { transientFailures: 0 };

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onRcptTo(address, _session, callback) {
      const code = rejectRecipient?.(address.address.toLowerCase());
      if (typeof code === "number") {
        if (code >= 400 && code < 500) state.transientFailures += 1;
        return callback(Object.assign(new Error("Recipient rejected"), { responseCode: code }));
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const headerBlock = raw.slice(0, raw.indexOf("\r\n\r\n"));
        const header = (name: string) =>
          new RegExp(`^${name}:\\s*(.+)$`, "im").exec(headerBlock)?.[1]?.trim();
        const body = decodeBody(raw);
        const htmlMatch = /<html[\s\S]*<\/html>/i.exec(body);
        messages.push({
          from: session.envelope.mailFrom
            ? String((session.envelope.mailFrom as { address?: string }).address ?? "")
            : "",
          to: session.envelope.rcptTo.map(
            (rcpt: { address?: string }) => String(rcpt.address ?? "")
          ),
          raw,
          subject: header("Subject"),
          html: htmlMatch?.[0],
          text: /text\/plain/i.test(headerBlock)
            ? body
            : body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          header,
        });
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.server.address() as AddressInfo).port;

  return {
    url: `smtp://127.0.0.1:${port}`,
    messages,
    get transientFailures() {
      return state.transientFailures;
    },
    reset() {
      messages.length = 0;
      state.transientFailures = 0;
    },
    async close() {
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

/** Returns the first captured message whose header matches. */
export const findMessage = (
  sink: LocalSmtpSink,
  matcher: { to?: string; subject?: string }
) =>
  sink.messages.find(message => {
    if (matcher.to && !message.to.includes(matcher.to)) return false;
    if (matcher.subject && !(message.subject ?? "").includes(matcher.subject))
      return false;
    return true;
  });

/** Extracts the single-use token from a link in the captured message body. */
export function tokenFromMessage(message: CapturedMessage | undefined, path: string) {
  if (!message) return undefined;
  const body = `${message.html ?? ""}\n${message.raw}`;
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]{16,})`).exec(body);
  return match?.[1];
}

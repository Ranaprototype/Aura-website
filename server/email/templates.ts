/**
 * The seven Phase 2 notification templates. Every template renders both HTML
 * and plain text from the same data, escapes all interpolated values and never
 * receives a password or an SMTP credential.
 */
export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

/** Removes control characters, including CR/LF and NUL, from any value. */
const clean = (value: string) =>
  value.replace(/[\u0000-\u001f\u007f]/g, "");

const escapeHtml = (value: string) =>
  clean(value).replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character
  );

const escapeText = (value: string) => clean(value);

interface LayoutInput {
  heading: string;
  intro: string;
  action?: { label: string; url: string };
  facts?: Array<{ label: string; value: string }>;
  footer: string;
}

function layout({ heading, intro, action, facts, footer }: LayoutInput) {
  const safeHeading = escapeHtml(heading);
  const safeIntro = escapeHtml(intro);
  const factsHtml = (facts ?? [])
    .map(
      fact =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px">${escapeHtml(
          fact.label
        )}</td><td style="padding:4px 0;color:#111827;font-size:13px">${escapeHtml(
          fact.value
        )}</td></tr>`
    )
    .join("");
  const actionHtml = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#111827;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-size:14px">${escapeHtml(
        action.label
      )}</a></p><p style="color:#6b7280;font-size:12px;word-break:break-all">${escapeHtml(
        action.url
      )}</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeHeading}</title></head><body style="margin:0;background:#f9fafb;font-family:system-ui,-apple-system,'Segoe UI',sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:32px"><tr><td><p style="margin:0 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b7280">AURA</p><h1 style="margin:0 0 16px;font-size:22px;color:#111827">${safeHeading}</h1><p style="margin:0;color:#374151;font-size:15px;line-height:1.6">${safeIntro}</p>${actionHtml}${
    factsHtml ? `<table role="presentation" cellpadding="0" cellspacing="0">${factsHtml}</table>` : ""
  }<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px"><p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6">${escapeHtml(
    footer
  )}</p></td></tr></table></td></tr></table></body></html>`;
}

const factsText = (facts?: Array<{ label: string; value: string }>) =>
  (facts ?? []).map(fact => `${escapeText(fact.label)}: ${escapeText(fact.value)}`).join("\n");

export interface WelcomeData {
  name: string;
  orgName: string;
  appUrl: string;
}
export interface VerifyEmailData {
  name: string;
  verifyUrl: string;
  expiresInMinutes: number;
}
export interface PasswordResetData {
  name: string;
  resetUrl: string;
  expiresInMinutes: number;
}
export interface InvitationData {
  inviterName: string;
  orgName: string;
  role: string;
  acceptUrl: string;
  expiresInDays: number;
}
export interface MembershipRevokedData {
  orgName: string;
  actorName: string;
  appUrl: string;
}
export interface RoleChangedData {
  orgName: string;
  previousRole: string;
  newRole: string;
  actorName: string;
  appUrl: string;
}
export interface SecurityAlertData {
  name: string;
  detail: string;
  occurredAt: string;
  appUrl: string;
}

interface TemplateDefinition<Data> {
  subject: (data: Data) => string;
  html: (data: Data) => string;
  text: (data: Data) => string;
}

const definition = <Data>(build: {
  subject: (data: Data) => string;
  heading: (data: Data) => string;
  intro: (data: Data) => string;
  action?: (data: Data) => { label: string; url: string };
  facts?: (data: Data) => Array<{ label: string; value: string }>;
  footer: (data: Data) => string;
  text: (data: Data) => string;
}): TemplateDefinition<Data> => ({
  subject: build.subject,
  html: data => {
    const action = build.action?.(data);
    const facts = build.facts?.(data);
    return layout({
      heading: build.heading(data),
      intro: build.intro(data),
      action,
      facts,
      footer: build.footer(data),
    });
  },
  text: build.text,
});

export const templates = {
  welcome: definition<WelcomeData>({
    subject: data => `Welcome to AURA, ${data.name}`,
    heading: () => "Your AURA workspace is ready",
    intro: data =>
      `Hello ${data.name}. ${data.orgName} has been created and you are its owner. Add a project to start a specification.`,
    action: data => ({ label: "Open your workspace", url: data.appUrl }),
    footer: () =>
      "You received this message because an AURA account was created with this address.",
    text: data =>
      `Hello ${data.name},\n\n${data.orgName} has been created and you are its owner.\nOpen your workspace: ${data.appUrl}\n\nYou received this message because an AURA account was created with this address.\n`,
  }),
  "verify-email": definition<VerifyEmailData>({
    subject: () => "Confirm your AURA email address",
    heading: () => "Confirm your email address",
    intro: data =>
      `Hello ${data.name}. Confirm this address to unlock protected workspace actions. The link expires in ${data.expiresInMinutes} minutes and can be used once.`,
    action: data => ({ label: "Confirm email address", url: data.verifyUrl }),
    footer: () =>
      "If you did not create an AURA account you can ignore this message; no account is activated without confirmation.",
    text: data =>
      `Hello ${data.name},\n\nConfirm your AURA email address (expires in ${data.expiresInMinutes} minutes, single use):\n${data.verifyUrl}\n\nIf you did not create an AURA account you can ignore this message.\n`,
  }),
  "password-reset": definition<PasswordResetData>({
    subject: () => "Reset your AURA password",
    heading: () => "Reset your password",
    intro: data =>
      `Hello ${data.name}. Use the single-use link below to choose a new password. It expires in ${data.expiresInMinutes} minutes. Resetting a password signs out every other session.`,
    action: data => ({ label: "Choose a new password", url: data.resetUrl }),
    footer: () =>
      "If you did not request a reset, no action is required and your password is unchanged.",
    text: data =>
      `Hello ${data.name},\n\nReset your AURA password (single use, expires in ${data.expiresInMinutes} minutes):\n${data.resetUrl}\n\nIf you did not request a reset, no action is required and your password is unchanged.\n`,
  }),
  invitation: definition<InvitationData>({
    subject: data => `${data.inviterName} invited you to ${data.orgName} on AURA`,
    heading: () => "You have been invited",
    intro: data =>
      `${data.inviterName} invited this address to join ${data.orgName} as ${data.role}. Sign in with this email address to accept. The invitation expires in ${data.expiresInDays} days.`,
    action: data => ({ label: "Accept invitation", url: data.acceptUrl }),
    facts: data => [
      { label: "Organization", value: data.orgName },
      { label: "Role", value: data.role },
    ],
    footer: () =>
      "Invitations are bound to the address that received this message and cannot be transferred.",
    text: data =>
      `${data.inviterName} invited this address to join ${data.orgName} as ${data.role}.\nAccept: ${data.acceptUrl}\nThis invitation expires in ${data.expiresInDays} days and is bound to this email address.\n`,
  }),
  "membership-revoked": definition<MembershipRevokedData>({
    subject: data => `Your access to ${data.orgName} was removed`,
    heading: () => "Organization access removed",
    intro: data =>
      `${data.actorName} removed this account from ${data.orgName}. Protected requests for that organization are denied from now on.`,
    action: data => ({ label: "Open AURA", url: data.appUrl }),
    facts: data => [{ label: "Organization", value: data.orgName }],
    footer: () =>
      "If you believe this was a mistake, contact an owner of the organization.",
    text: data =>
      `${data.actorName} removed this account from ${data.orgName}.\nProtected requests for that organization are denied from now on.\n\nOpen AURA: ${data.appUrl}\n`,
  }),
  "role-changed": definition<RoleChangedData>({
    subject: data => `Your role in ${data.orgName} changed`,
    heading: () => "Your role changed",
    intro: data =>
      `${data.actorName} changed this account's role in ${data.orgName} from ${data.previousRole} to ${data.newRole}.`,
    action: data => ({ label: "Open AURA", url: data.appUrl }),
    facts: data => [
      { label: "Organization", value: data.orgName },
      { label: "Previous role", value: data.previousRole },
      { label: "New role", value: data.newRole },
    ],
    footer: () =>
      "Permissions are re-evaluated on every request; this message is informational.",
    text: data =>
      `${data.actorName} changed this account's role in ${data.orgName} from ${data.previousRole} to ${data.newRole}.\n\nOpen AURA: ${data.appUrl}\n`,
  }),
  "security-alert": definition<SecurityAlertData>({
    subject: () => "AURA security notice",
    heading: () => "Security notice",
    intro: data =>
      `Hello ${data.name}. ${data.detail} If this was not you, reset your password and sign out other sessions.`,
    action: data => ({ label: "Open AURA", url: data.appUrl }),
    facts: data => [{ label: "When", value: data.occurredAt }],
    footer: () =>
      "AURA never asks for your password by email. This message contains no sign-in link.",
    text: data =>
      `Hello ${data.name},\n\n${data.detail}\nWhen: ${data.occurredAt}\nIf this was not you, reset your password and sign out other sessions.\n`,
  }),
} as const;

export type EmailTemplateName = keyof typeof templates;
export type TemplateData<Name extends EmailTemplateName> =
  typeof templates[Name] extends TemplateDefinition<infer Data> ? Data : never;

const emailShape = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

/**
 * Normalizes and validates a recipient. Control characters are refused so a
 * header cannot be injected, and the address is lower-cased for dedupe keys.
 */
export function normalizeRecipient(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 320) return undefined;
  if (/[\u0000-\u0020\u007f]/.test(trimmed)) return undefined;
  const lower = trimmed.toLowerCase();
  if (!emailShape.test(lower)) return undefined;
  return lower;
}

export function renderEmail<Name extends EmailTemplateName>(
  template: Name,
  data: TemplateData<Name>
): RenderedTemplate {
  const entry = templates[template] as TemplateDefinition<TemplateData<Name>>;
  return {
    subject: clean(entry.subject(data)),
    html: entry.html(data),
    // The plain-text alternative keeps newlines and tabs but never a stray CR,
    // NUL or other control character that could confuse a mail agent.
    text: entry.text(data).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""),
  };
}

export const templateNames = Object.keys(templates) as EmailTemplateName[];

/**
 * Runtime entry point for the delivery service. The typed `renderEmail` is used
 * wherever the template name is a literal; here the payload has already been
 * produced by trusted server code for that template.
 */
export function renderEmailDynamic(
  template: EmailTemplateName,
  data: unknown
): RenderedTemplate {
  return renderEmail(template, data as never);
}

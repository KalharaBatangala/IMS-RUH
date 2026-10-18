import { Resend } from 'resend';
import type { EmailKind } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// Outbound email through Resend (an EXTERNAL service: see CLAUDE.md, Section 2).
//
// Off unless EMAIL_ENABLED="true" AND RESEND_API_KEY is set. It is meant for development
// testing until the university approves the provider, DNS (SPF/DKIM) and outbound access.
//
// Rules this module follows:
// - Email never decides whether a workflow step succeeded. Callers send AFTER the database
//   transaction has committed, and sendEmail() never throws.
// - Every attempt is recorded in EmailDelivery (SENT / FAILED). Only metadata is stored:
//   the body (which may contain a one-time code) is never written to the database or logs.

const DEFAULT_FROM = 'DEIE Labs <onboarding@resend.dev>';

let client: Resend | null = null;
let warnedMissingKey = false;

export function emailEnabled(): boolean {
  if (process.env.EMAIL_ENABLED !== 'true') return false;
  if (!process.env.RESEND_API_KEY) {
    if (!warnedMissingKey) {
      console.warn('[email] EMAIL_ENABLED is "true" but RESEND_API_KEY is not set; emails are not sent.');
      warnedMissingKey = true;
    }
    return false;
  }
  return true;
}

function getClient(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

// Development aid: send every email to one inbox (Resend's test sender only delivers to
// the account owner's address). Ignored in production so real users are never bypassed.
function testRecipient(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const to = process.env.EMAIL_TEST_RECIPIENT?.trim();
  return to ? to : null;
}

export function appUrl(path = '/'): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return base + (path.startsWith('/') ? path : `/${path}`);
}

export async function sendEmail(input: {
  to: string;
  userId?: string;
  kind: EmailKind;
  subject: string;
  text: string;
  html: string;
  logId?: string;
}): Promise<boolean> {
  if (!emailEnabled()) return false;

  const redirect = testRecipient();
  const to = redirect ?? input.to;
  const subject = redirect ? `[Test → ${input.to}] ${input.subject}` : input.subject;

  let status: 'SENT' | 'FAILED' = 'FAILED';
  let providerMessageId: string | null = null;
  let error: string | null = null;
  try {
    const { data, error: sendError } = await getClient().emails.send({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to,
      subject,
      text: input.text,
      html: input.html,
    });
    if (sendError) {
      error = `${sendError.name ?? 'error'}: ${sendError.message ?? ''}`.slice(0, 500);
    } else {
      status = 'SENT';
      providerMessageId = data?.id ?? null;
    }
  } catch (e) {
    error = (e instanceof Error ? e.message : 'Unknown error').slice(0, 500);
  }

  if (error) console.error(`[email] ${input.kind} to user ${input.userId ?? '-'} failed: ${error}`);

  try {
    await prisma.emailDelivery.create({
      data: {
        userId: input.userId ?? null,
        toEmail: to,
        intendedEmail: redirect ? input.to : null,
        kind: input.kind,
        subject,
        status,
        providerMessageId,
        error,
        logId: input.logId ?? null,
      },
    });
  } catch (e) {
    console.error('[email] failed to record delivery outcome', e);
  }
  return status === 'SENT';
}

// ---------------------------------------------------------------------------
// Templates: plain, table-based HTML that renders in Outlook / Gmail, plus a text part.
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function layout(opts: { heading: string; bodyHtml: string; link?: string; linkLabel?: string }): string {
  const button = opts.link
    ? `<tr><td style="padding:8px 32px 28px"><a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#1e3a5f;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(opts.linkLabel ?? 'Open DEIE Labs')}</a></td></tr>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 12px;font-family:'Segoe UI',Arial,sans-serif">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
<tr><td style="background:#1e3a5f;padding:18px 32px">
<span style="color:#ffffff;font-size:16px;font-weight:600">DEIE</span> <span style="color:#c8d4e3;font-size:16px">Labs</span>
<div style="color:#9fb2cb;font-size:10px;letter-spacing:2px;text-transform:uppercase;margin-top:4px">University of Ruhuna</div>
</td></tr>
<tr><td style="padding:28px 32px 8px"><h1 style="margin:0 0 12px;font-size:18px;color:#0f172a">${escapeHtml(opts.heading)}</h1>${opts.bodyHtml}</td></tr>
${button}
<tr><td style="border-top:1px solid #e2e8f0;padding:16px 32px;color:#94a3b8;font-size:11px;line-height:1.5">
Automated message from DEIE Labs, Department of Electrical and Information Engineering, University of Ruhuna. Please do not reply to this email.
</td></tr>
</table></td></tr></table></body></html>`;
}

const paragraph = (text: string) =>
  `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(text)}</p>`;

export function notificationEmail(message: { title: string; body: string; link?: string }) {
  const link = appUrl(message.link ?? '/dashboard/notifications');
  return {
    subject: `${message.title} — DEIE Labs`,
    text: `${message.title}\n\n${message.body}\n\nOpen DEIE Labs: ${link}\n\nThis is an automated message. Please do not reply.`,
    html: layout({ heading: message.title, bodyHtml: paragraph(message.body), link }),
  };
}

// The code appears only in the body, never in the subject (subjects show on lock screens
// and in notification previews).
export function handoverCodeEmail(input: {
  borrowerName: string;
  equipmentName: string;
  serialNumber: string;
  labName: string;
  code: string;
  expiresAt: Date;
  regenerated?: boolean;
}) {
  const expires = input.expiresAt.toLocaleString();
  const intro = input.regenerated
    ? `A new handover code was issued for your reservation. Any earlier code no longer works.`
    : `Your request for "${input.equipmentName}" has been recommended. Unit ${input.serialNumber} is reserved for you.`;
  const steps = `Go to ${input.labName} before ${expires} and present this code to the Technical Officer. They will check the unit and record the handover.`;
  const warning = 'Keep this code private. Share it only with the Technical Officer at handover. DEIE Labs staff will never ask for it by email or phone.';
  return {
    subject: input.regenerated ? `New handover code for ${input.equipmentName}` : `Your handover code for ${input.equipmentName}`,
    text: `Dear ${input.borrowerName},\n\n${intro}\n\nHandover code: ${input.code}\nUnit: ${input.serialNumber}\nValid until: ${expires}\n\n${steps}\n\n${warning}\n\nDEIE Labs: ${appUrl('/dashboard/borrow')}`,
    html: layout({
      heading: input.regenerated ? 'New handover code' : 'Your equipment is reserved',
      bodyHtml:
        paragraph(`Dear ${input.borrowerName},`) +
        paragraph(intro) +
        `<div style="margin:20px 0;padding:18px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;text-align:center">
<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#64748b">Handover code</div>
<div style="font-family:Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#1e3a5f;margin:6px 0">${escapeHtml(input.code)}</div>
<div style="font-size:12px;color:#64748b">Unit ${escapeHtml(input.serialNumber)} · valid until ${escapeHtml(expires)}</div>
</div>` +
        paragraph(steps) +
        `<p style="margin:0 0 12px;font-size:12px;line-height:1.6;color:#b45309">${escapeHtml(warning)}</p>`,
      link: appUrl('/dashboard/borrow'),
      linkLabel: 'View my requests',
    }),
  };
}

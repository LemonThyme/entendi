/**
 * Email service using Resend.
 * Gracefully skips sending if RESEND_API_KEY is not configured.
 */
import { Resend } from 'resend';

export enum EmailTemplate {
  OrgInvite = 'org_invite',
  ApiKeyCreated = 'api_key_created',
  DeviceLinked = 'device_linked',
  EarnedFreeUnlocked = 'earned_free_unlocked',
  EarnedFreeExpiring = 'earned_free_expiring',
  SubscriptionConfirmed = 'subscription_confirmed',
  MasterySummary = 'mastery_summary',
  OrgAdminDigest = 'org_admin_digest',
}

export interface EmailData {
  to: string;
  template: EmailTemplate;
  vars: Record<string, string>;
}

export function getSubject(template: EmailTemplate, vars: Record<string, string>): string {
  switch (template) {
    case EmailTemplate.OrgInvite:
      return `You've been invited to ${vars.orgName || 'an organization'} on Entendi`;
    case EmailTemplate.ApiKeyCreated:
      return 'Your Entendi API key has been created';
    case EmailTemplate.DeviceLinked:
      return 'A new device has been linked to your Entendi account';
    case EmailTemplate.EarnedFreeUnlocked:
      return 'You earned free Entendi Pro access!';
    case EmailTemplate.EarnedFreeExpiring:
      return 'Your earned free Entendi Pro access expires soon';
    case EmailTemplate.SubscriptionConfirmed:
      return `Welcome to Entendi ${vars.plan || 'Pro'}!`;
    case EmailTemplate.MasterySummary:
      return `Your weekly mastery summary — ${vars.date || 'this week'}`;
    case EmailTemplate.OrgAdminDigest:
      return `${vars.orgName || 'Team'} weekly learning digest`;
  }
}

export function getHtml(template: EmailTemplate, vars: Record<string, string>): string {
  const header = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a2e;">
      <div style="border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px;">
        <strong style="font-size: 18px; color: #4f46e5;">Entendi</strong>
      </div>`;
  const footer = `
      <div style="border-top: 1px solid #e5e7eb; margin-top: 24px; padding-top: 12px; font-size: 12px; color: #9ca3af;">
        Entendi — Comprehension accountability for AI-assisted work
      </div>
    </div>`;

  switch (template) {
    case EmailTemplate.OrgInvite:
      return `${header}
        <p>You've been invited to join <strong>${esc(vars.orgName)}</strong> on Entendi.</p>
        <p><a href="${esc(vars.inviteLink)}" style="display: inline-block; padding: 10px 20px; background: #4f46e5; color: white; text-decoration: none; border-radius: 6px;">Accept Invitation</a></p>
        <p style="font-size: 13px; color: #6b7280;">If you don't have an account, one will be created when you accept.</p>
      ${footer}`;

    case EmailTemplate.ApiKeyCreated:
      return `${header}
        <p>A new API key has been created for your account.</p>
        <p style="font-size: 13px; color: #6b7280;">If you didn't create this key, please review your account security.</p>
      ${footer}`;

    case EmailTemplate.DeviceLinked:
      return `${header}
        <p>A new device has been linked to your Entendi account.</p>
        <p style="font-size: 13px; color: #6b7280;">If you didn't link this device, please review your account security.</p>
      ${footer}`;

    case EmailTemplate.EarnedFreeUnlocked:
      return `${header}
        <h2 style="color: #059669;">Congratulations!</h2>
        <p>You've demonstrated strong mastery across your tracked concepts. As a reward, you've earned <strong>free Pro access</strong> for the next 2 weeks.</p>
        <p>Keep learning and maintaining your mastery to renew it automatically.</p>
        <p style="font-size: 13px; color: #6b7280;">Expires: ${esc(vars.expiresAt)}</p>
      ${footer}`;

    case EmailTemplate.EarnedFreeExpiring:
      return `${header}
        <p>Your earned free Pro access expires on <strong>${esc(vars.expiresAt)}</strong>.</p>
        <p>Keep demonstrating mastery to renew, or <a href="${esc(vars.upgradeLink)}" style="color: #4f46e5;">upgrade to Pro</a>.</p>
      ${footer}`;

    case EmailTemplate.SubscriptionConfirmed:
      return `${header}
        <h2>Welcome to Entendi ${esc(vars.plan)}!</h2>
        <p>Your subscription is now active. You have access to all ${esc(vars.plan)} features.</p>
      ${footer}`;

    case EmailTemplate.MasterySummary:
      return `${header}
        <h2>Your Weekly Mastery Summary</h2>
        <p style="font-size: 14px; color: #6b7280;">${esc(vars.date)}</p>
        ${vars.sparkline || ''}
        <div style="margin: 16px 0;">
          ${vars.improved ? `<p style="color: #059669;">Improved: ${esc(vars.improved)}</p>` : ''}
          ${vars.decayed ? `<p style="color: #dc2626;">Needs review: ${esc(vars.decayed)}</p>` : ''}
          ${vars.totalConcepts ? `<p>Total concepts tracked: ${esc(vars.totalConcepts)}</p>` : ''}
        </div>
        <p><a href="${esc(vars.dashboardLink || '')}" style="color: #4f46e5;">View full dashboard</a></p>
      ${footer}`;

    case EmailTemplate.OrgAdminDigest:
      return `${header}
        <h2>${esc(vars.orgName)} — Weekly Digest</h2>
        <div style="margin: 16px 0;">
          ${vars.summaryHtml || '<p>No activity this week.</p>'}
        </div>
      ${footer}`;
  }
}

function esc(s: string | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let resendInstance: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendInstance) {
    resendInstance = new Resend(process.env.RESEND_API_KEY);
  }
  return resendInstance;
}

/** Reset the cached Resend instance (for testing). */
export function resetResendInstance(): void {
  resendInstance = null;
}

export interface SendEmailResult {
  id?: string;
  skipped?: boolean;
  error?: string;
}

export async function sendEmail(data: EmailData): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    return { skipped: true };
  }

  const subject = getSubject(data.template, data.vars);
  const html = getHtml(data.template, data.vars);

  try {
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Entendi <noreply@entendi.dev>',
      to: data.to,
      subject,
      html,
    });

    if (result.error) {
      return { error: result.error.message };
    }

    return { id: result.data?.id };
  } catch (err) {
    return { error: String(err) };
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EmailTemplate,
  getSubject,
  getHtml,
  sendEmail,
  resetResendInstance,
} from '../../src/api/lib/email.js';

const mockSend = vi.fn().mockResolvedValue({ data: { id: 'mock-email-id' }, error: null });

// Mock Resend with a proper class constructor
vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
      constructor(_apiKey: string) {}
    },
  };
});

describe('email service', () => {
  beforeEach(() => {
    resetResendInstance();
    mockSend.mockClear();
    mockSend.mockResolvedValue({ data: { id: 'mock-email-id' }, error: null });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    resetResendInstance();
  });

  describe('getSubject', () => {
    it('returns org invite subject with org name', () => {
      const subject = getSubject(EmailTemplate.OrgInvite, { orgName: 'Acme Corp' });
      expect(subject).toContain('Acme Corp');
      expect(subject).toContain('invited');
    });

    it('returns API key created subject', () => {
      const subject = getSubject(EmailTemplate.ApiKeyCreated, {});
      expect(subject).toContain('API key');
    });

    it('returns earned free unlocked subject', () => {
      const subject = getSubject(EmailTemplate.EarnedFreeUnlocked, {});
      expect(subject).toContain('earned free');
    });

    it('returns mastery summary subject with date', () => {
      const subject = getSubject(EmailTemplate.MasterySummary, { date: 'Feb 24, 2026' });
      expect(subject).toContain('Feb 24, 2026');
    });

    it('returns subscription confirmed subject with plan', () => {
      const subject = getSubject(EmailTemplate.SubscriptionConfirmed, { plan: 'Team' });
      expect(subject).toContain('Team');
    });
  });

  describe('getHtml', () => {
    it('returns HTML with org invite link', () => {
      const html = getHtml(EmailTemplate.OrgInvite, {
        orgName: 'Acme Corp',
        inviteLink: 'https://entendi.dev/invite/abc',
      });
      expect(html).toContain('Acme Corp');
      expect(html).toContain('https://entendi.dev/invite/abc');
      expect(html).toContain('Accept Invitation');
    });

    it('returns HTML for API key created', () => {
      const html = getHtml(EmailTemplate.ApiKeyCreated, {});
      expect(html).toContain('API key');
      expect(html).toContain('Entendi');
    });

    it('returns HTML for earned free unlocked', () => {
      const html = getHtml(EmailTemplate.EarnedFreeUnlocked, { expiresAt: 'March 10, 2026' });
      expect(html).toContain('Congratulations');
      expect(html).toContain('March 10, 2026');
      expect(html).toContain('free Pro access');
    });

    it('returns HTML for mastery summary with sparkline', () => {
      const sparkline = '<svg><polyline points="0,10 50,5 100,8" /></svg>';
      const html = getHtml(EmailTemplate.MasterySummary, {
        date: 'Feb 24, 2026',
        sparkline,
        improved: 'TypeScript, React',
        decayed: 'SQL',
        totalConcepts: '15',
        dashboardLink: 'https://entendi.dev/dashboard',
      });
      expect(html).toContain('Weekly Mastery Summary');
      expect(html).toContain('Feb 24, 2026');
      expect(html).toContain(sparkline);
      expect(html).toContain('TypeScript, React');
      expect(html).toContain('SQL');
      expect(html).toContain('15');
    });

    it('escapes HTML in template variables', () => {
      const html = getHtml(EmailTemplate.OrgInvite, {
        orgName: '<script>alert("xss")</script>',
        inviteLink: 'https://example.com',
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  describe('sendEmail', () => {
    it('skips when RESEND_API_KEY is not set', async () => {
      const result = await sendEmail({
        to: 'test@example.com',
        template: EmailTemplate.ApiKeyCreated,
        vars: {},
      });
      expect(result.skipped).toBe(true);
      expect(result.id).toBeUndefined();
    });

    it('sends email when RESEND_API_KEY is set', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      const result = await sendEmail({
        to: 'user@example.com',
        template: EmailTemplate.OrgInvite,
        vars: { orgName: 'Test Org', inviteLink: 'https://entendi.dev/invite/123' },
      });
      expect(result.id).toBe('mock-email-id');
      expect(result.skipped).toBeUndefined();
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Test Org'),
          html: expect.stringContaining('Test Org'),
        }),
      );
    });

    it('uses default from email', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      await sendEmail({
        to: 'user@example.com',
        template: EmailTemplate.ApiKeyCreated,
        vars: {},
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Entendi <noreply@entendi.dev>',
        }),
      );
    });

    it('uses custom from email when configured', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      process.env.RESEND_FROM_EMAIL = 'Custom <custom@entendi.dev>';
      await sendEmail({
        to: 'user@example.com',
        template: EmailTemplate.ApiKeyCreated,
        vars: {},
      });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'Custom <custom@entendi.dev>',
        }),
      );
    });

    it('returns error on Resend API error', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      mockSend.mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });

      const result = await sendEmail({
        to: 'user@example.com',
        template: EmailTemplate.ApiKeyCreated,
        vars: {},
      });
      expect(result.error).toBe('rate limited');
    });

    it('returns error on exception', async () => {
      process.env.RESEND_API_KEY = 'test-key';
      mockSend.mockRejectedValueOnce(new Error('network failure'));

      const result = await sendEmail({
        to: 'user@example.com',
        template: EmailTemplate.ApiKeyCreated,
        vars: {},
      });
      expect(result.error).toContain('network failure');
    });
  });
});

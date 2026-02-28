import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCheckoutSession, resetStripeInstance } from '../../src/api/lib/stripe.js';

const mockCreate = vi.fn().mockResolvedValue({
  id: 'cs_test_123',
  url: 'https://checkout.stripe.com/test',
});

vi.mock('stripe', () => {
  return {
    default: class MockStripe {
      checkout = { sessions: { create: mockCreate } };
      webhooks = { constructEvent: vi.fn() };
    },
  };
});

describe('Stripe integration', () => {
  beforeEach(() => {
    resetStripeInstance();
    mockCreate.mockClear();
    mockCreate.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/test',
    });
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    resetStripeInstance();
  });

  describe('createCheckoutSession', () => {
    it('returns null when STRIPE_SECRET_KEY is not set', async () => {
      const result = await createCheckoutSession({
        userId: 'user1',
        email: 'test@example.com',
        plan: 'pro',
        successUrl: 'https://entendi.dev/dashboard?billing=success',
        cancelUrl: 'https://entendi.dev/dashboard?billing=cancelled',
      });
      expect(result).toBeNull();
    });

    it('creates checkout session when Stripe is configured', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      const result = await createCheckoutSession({
        userId: 'user1',
        email: 'test@example.com',
        plan: 'pro',
        successUrl: 'https://entendi.dev/dashboard?billing=success',
        cancelUrl: 'https://entendi.dev/dashboard?billing=cancelled',
      });
      expect(result).not.toBeNull();
      expect(result!.url).toBe('https://checkout.stripe.com/test');
      expect(result!.sessionId).toBe('cs_test_123');
    });

    it('passes correct params for pro plan', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      await createCheckoutSession({
        userId: 'user1',
        email: 'test@example.com',
        plan: 'pro',
        successUrl: 'https://entendi.dev/success',
        cancelUrl: 'https://entendi.dev/cancel',
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer_email: 'test@example.com',
          line_items: expect.arrayContaining([
            expect.objectContaining({ quantity: 1 }),
          ]),
          metadata: expect.objectContaining({
            userId: 'user1',
            plan: 'pro',
          }),
        }),
      );
    });

    it('passes seat count for team plan', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      await createCheckoutSession({
        userId: 'user1',
        email: 'test@example.com',
        plan: 'team',
        successUrl: 'https://entendi.dev/success',
        cancelUrl: 'https://entendi.dev/cancel',
        organizationId: 'org1',
        seatCount: 10,
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({ quantity: 10 }),
          ]),
          metadata: expect.objectContaining({
            organizationId: 'org1',
            plan: 'team',
          }),
        }),
      );
    });

    it('defaults team seat count to 5', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      await createCheckoutSession({
        userId: 'user1',
        email: 'test@example.com',
        plan: 'team',
        successUrl: 'https://entendi.dev/success',
        cancelUrl: 'https://entendi.dev/cancel',
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: expect.arrayContaining([
            expect.objectContaining({ quantity: 5 }),
          ]),
        }),
      );
    });
  });
});

/**
 * Stripe integration for billing.
 * Creates checkout sessions and verifies webhook signatures.
 */
import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeInstance;
}

/** Reset cached Stripe instance (for testing). */
export function resetStripeInstance(): void {
  stripeInstance = null;
}

export interface CheckoutSessionParams {
  userId: string;
  email: string;
  plan: 'pro' | 'team';
  successUrl: string;
  cancelUrl: string;
  organizationId?: string;
  seatCount?: number;
}

export interface CheckoutSessionResult {
  url: string | null;
  sessionId: string;
}

const PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_placeholder',
  team: process.env.STRIPE_TEAM_PRICE_ID || 'price_team_placeholder',
};

export async function createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [{
    price: PRICE_IDS[params.plan],
    quantity: params.plan === 'team' ? (params.seatCount || 5) : 1,
  }];

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: params.email,
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      userId: params.userId,
      plan: params.plan,
      ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    },
  });

  return {
    url: session.url,
    sessionId: session.id,
  };
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
): Stripe.Event | null {
  const stripe = getStripe();
  if (!stripe) return null;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return null;

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

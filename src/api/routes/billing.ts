import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { subscriptions } from '../db/schema.js';
import { createCheckoutSession, constructWebhookEvent } from '../lib/stripe.js';
import { sendEmail, EmailTemplate } from '../lib/email.js';
import type { Env } from '../index.js';

export const billingRoutes = new Hono<Env>();

// POST /api/billing/checkout — create Stripe Checkout session
billingRoutes.post('/checkout', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json();
  const { plan, organizationId, seatCount } = body;

  if (!plan || !['pro', 'team'].includes(plan)) {
    return c.json({ error: 'plan must be "pro" or "team"' }, 400);
  }

  const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3456';
  const result = await createCheckoutSession({
    userId: user.id,
    email: user.email,
    plan,
    successUrl: `${baseUrl}/dashboard?billing=success`,
    cancelUrl: `${baseUrl}/dashboard?billing=cancelled`,
    organizationId,
    seatCount,
  });

  if (!result) {
    return c.json({ error: 'Stripe is not configured' }, 503);
  }

  return c.json({ url: result.url, sessionId: result.sessionId });
});

// GET /api/billing/subscription — get current subscription
billingRoutes.get('/subscription', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.get('db');
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id));

  if (rows.length === 0) {
    return c.json({ plan: 'free', status: 'active' });
  }

  const sub = rows[0];
  return c.json({
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    seatCount: sub.seatCount,
    earnedFreeUntil: sub.earnedFreeUntil,
  });
});

// POST /api/billing/webhook — Stripe webhook handler (no auth, signature verified)
billingRoutes.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  const payload = await c.req.text();
  let event;
  try {
    event = constructWebhookEvent(payload, signature);
  } catch (err) {
    return c.json({ error: 'Webhook signature verification failed' }, 400);
  }

  if (!event) {
    return c.json({ error: 'Stripe is not configured' }, 503);
  }

  const db = c.get('db');

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as any;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;
      const organizationId = session.metadata?.organizationId;

      if (!userId || !plan) break;

      const subId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.insert(subscriptions).values({
        id: subId,
        userId,
        organizationId: organizationId || null,
        stripeCustomerId: session.customer || '',
        stripeSubscriptionId: session.subscription || '',
        plan,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        seatCount: plan === 'team' ? (session.metadata?.seatCount || 5) : null,
      });

      // Send confirmation email
      const userEmail = session.customer_email || session.customer_details?.email;
      if (userEmail) {
        await sendEmail({
          to: userEmail,
          template: EmailTemplate.SubscriptionConfirmed,
          vars: { plan: plan.charAt(0).toUpperCase() + plan.slice(1) },
        });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as any;
      await db
        .update(subscriptions)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as any;
      if (invoice.subscription) {
        await db
          .update(subscriptions)
          .set({
            status: 'active',
            currentPeriodEnd: new Date((invoice.lines?.data?.[0]?.period?.end || Date.now() / 1000) * 1000),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeSubscriptionId, invoice.subscription));
      }
      break;
    }
  }

  return c.json({ received: true });
});

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, apiKey, bearer } from 'better-auth/plugins';
import { eq, and } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { invitation, member } from '../db/schema.js';
import { sendEmail, EmailTemplate } from './email.js';

function buildSocialProviders(): Record<string, { clientId: string; clientSecret: string }> | undefined {
  const providers: Record<string, { clientId: string; clientSecret: string }> = {};

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  return Object.keys(providers).length > 0 ? providers : undefined;
}

export function createAuth(db: Database, options?: { secret?: string; baseURL?: string }) {
  const socialProviders = buildSocialProviders();

  return betterAuth({
    secret: options?.secret || process.env.BETTER_AUTH_SECRET,
    baseURL: options?.baseURL || process.env.BETTER_AUTH_URL || 'http://localhost:3456',
    basePath: '/api/auth',

    database: drizzleAdapter(db, {
      provider: 'pg',
    }),

    emailAndPassword: {
      enabled: true,
    },

    ...(socialProviders ? { socialProviders } : {}),

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Auto-accept pending org invitations matching the new user's email
            try {
              const pendingInvitations = await db.select()
                .from(invitation)
                .where(and(
                  eq(invitation.email, user.email),
                  eq(invitation.status, 'pending'),
                ));

              for (const inv of pendingInvitations) {
                const memberId = crypto.randomUUID();
                await db.insert(member).values({
                  id: memberId,
                  userId: user.id,
                  organizationId: inv.organizationId,
                  role: inv.role,
                });
                await db.update(invitation)
                  .set({ status: 'accepted' })
                  .where(eq(invitation.id, inv.id));
              }
            } catch {
              // Non-critical — don't fail user creation if auto-accept fails
            }
          },
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh after 1 day
    },

    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: 'owner',
        sendInvitationEmail: async (data) => {
          const baseUrl = options?.baseURL || process.env.BETTER_AUTH_URL || 'http://localhost:3456';
          const inviteLink = `${baseUrl}/api/auth/organization/accept-invitation?invitationId=${data.id}`;
          await sendEmail({
            to: data.email,
            template: EmailTemplate.OrgInvite,
            vars: {
              orgName: data.organization.name,
              inviteLink,
            },
          });
        },
      }),
      apiKey({
        enableSessionForAPIKeys: true,
        apiKeyHeaders: ['x-api-key'],
        rateLimit: { enabled: false },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

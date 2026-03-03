import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, apiKey, bearer, organization } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/connection.js';
import { invitation, member, orgRolePermissions, orgRoles } from '../db/schema.js';
import { EmailTemplate, sendEmail } from './email.js';
import { logger } from './logger.js';

const ADMIN_PERMISSIONS = [
  'codebases.create', 'codebases.edit', 'codebases.delete', 'codebases.view_progress',
  'syllabi.create', 'syllabi.edit', 'syllabi.delete', 'syllabi.view_progress',
  'members.invite', 'members.manage_roles', 'members.view',
  'org.settings',
];

const MEMBER_PERMISSIONS = ['members.view'];

export async function ensureBuiltInRoles(db: Database, orgId: string) {
  const existing = await db.select({ id: orgRoles.id })
    .from(orgRoles)
    .where(and(eq(orgRoles.orgId, orgId), eq(orgRoles.isDefault, true)))
    .limit(1);

  if (existing.length > 0) return;

  const adminRoleId = crypto.randomUUID();
  const memberRoleId = crypto.randomUUID();

  await db.insert(orgRoles).values([
    { id: adminRoleId, orgId, name: 'Admin', isDefault: true },
    { id: memberRoleId, orgId, name: 'Member', isDefault: true },
  ]);

  const adminPerms = ADMIN_PERMISSIONS.map(p => ({ roleId: adminRoleId, permission: p }));
  const memberPerms = MEMBER_PERMISSIONS.map(p => ({ roleId: memberRoleId, permission: p }));

  await db.insert(orgRolePermissions).values([...adminPerms, ...memberPerms]);
}

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

  const baseURL = options?.baseURL || process.env.BETTER_AUTH_URL || 'http://localhost:3456';

  return betterAuth({
    secret: options?.secret || process.env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [baseURL, 'https://entendi.dev', 'https://api.entendi.dev', 'https://entendi-api.tomaskorenblit.workers.dev'],

    database: drizzleAdapter(db, {
      provider: 'pg',
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: !!process.env.RESEND_API_KEY,
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        void sendEmail({
          to: user.email,
          template: EmailTemplate.EmailVerification,
          vars: { verifyLink: url },
        });
      },
    },

    ...(socialProviders ? { socialProviders } : {}),

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            logger.info('auth.user_created', { userId: user.id, email: user.email });
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
      admin(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

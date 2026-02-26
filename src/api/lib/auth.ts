import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, apiKey, bearer } from 'better-auth/plugins';
import type { Database } from '../db/connection.js';

export function createAuth(db: Database, options?: { secret?: string; baseURL?: string }) {
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

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh after 1 day
    },

    plugins: [
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: 'owner',
      }),
      apiKey({
        enableSessionForAPIKeys: true,
        apiKeyHeaders: ['x-api-key'],
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

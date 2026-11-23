import { env } from 'cloudflare:workers';
import { betterAuth } from 'better-auth';
import { admin, bearer } from 'better-auth/plugins';

const trustedOrigins = String(env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

const googleClientIds = String(env.GOOGLE_CLIENT_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
if (!googleClientIds.length && env.GOOGLE_CLIENT_ID) googleClientIds.push(env.GOOGLE_CLIENT_ID);
if (!googleClientIds.length && env.GOOGLE_ANDROID_CLIENT_ID) googleClientIds.push(env.GOOGLE_ANDROID_CLIENT_ID);

const socialProviders = {};
if (googleClientIds.length && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    // Better Auth accepts multiple audiences so the web OAuth client and the
    // Android ID-token client can both sign in to the same Worker.
    clientId: googleClientIds.length === 1 ? googleClientIds[0] : googleClientIds,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export const auth = betterAuth({
  appName: 'Khristian Labu',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: env.DB,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  socialProviders,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    window: 10,
    max: 30,
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['cf-connecting-ip'],
    },
  },
  plugins: [admin(), bearer()],
});

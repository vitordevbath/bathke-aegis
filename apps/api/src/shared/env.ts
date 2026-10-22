import { z } from 'zod';

/** Substrings that mark a placeholder or a well-known weak value. Compared case-insensitively. */
const WEAK_SECRET_MARKERS = ['change-me', 'changeme', 'secret', 'password', 'example', 'development', '123456', 'qwerty'];

export const JWT_SECRET_MIN_LENGTH = 32;

const JwtSecretSchema = z
  .string()
  .min(JWT_SECRET_MIN_LENGTH)
  .refine((value) => !WEAK_SECRET_MARKERS.some((marker) => value.toLowerCase().includes(marker)), 'placeholder or weak value')
  .refine((value) => new Set(value).size >= 10, 'too little variety');

const DatabaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

const EnvSchema = DatabaseEnvSchema.extend({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** HMAC key for access tokens. Required; there is no fallback. */
  JWT_SECRET: JwtSecretSchema,
  /** Access token lifetime in seconds (1 min – 24 h). */
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
  /** Requests per minute per client IP on `/auth/login` and `/auth/register`. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /** Event ingestion batches per client IP per minute on the user-auth lab route. */
  INGEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof EnvSchema>;
export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>;

function parse<T extends z.ZodTypeAny>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Only variable names are reported — never values.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}

/** Parses and validates the API environment. Never logs values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parse(EnvSchema, source);
}

/** Subset needed by the migration CLI. */
export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  return parse(DatabaseEnvSchema, source);
}

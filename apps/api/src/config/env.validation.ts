/**
 * Environment validation, run once at boot.
 *
 * The point of failing here rather than later: a missing or placeholder JWT
 * secret is not a degraded feature, it is a total authentication bypass. The
 * same goes for a bcrypt cost of 1, or a DATABASE_URL pointing at the migrator
 * role (which owns the tables and would make RLS a no-op for the whole app).
 *
 * Every one of these is cheap to detect at startup and expensive to discover in
 * production, so the process refuses to boot instead of warning.
 */

/** Placeholder values shipped in .env.example. Booting with one is a bug. */
const PLACEHOLDER_MARKERS = [
  'replace-me',
  'replace_me',
  'changeme',
  'change-me',
  'change_me',
  'your-secret-here',
  'placeholder',
  'example',
  'sample',
  'dummy',
  'todo',
];

/** Matches documentation template tokens like your_key_here, <token>, ... */
const DOC_PLACEHOLDER_REGEX = /^(your[-_]|.*[-_]here$|<.*>|\.\.\.)/i;

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase().trim();
  if (DOC_PLACEHOLDER_REGEX.test(lower)) return true;
  return PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

/** A 256-bit secret in base64 is ~43 chars; require enough to not be guessable. */
const MIN_SECRET_LENGTH = 32;

/**
 * What jsonwebtoken's `expiresIn` accepts: a plain number of seconds, or a
 * number with a units suffix ("15m", "7d", "24h").
 *
 * Checked here because the library types this as a template-literal union that a
 * value read from the environment cannot satisfy statically — the sign call
 * therefore casts, and this is what makes the cast honest. An unparseable value
 * would otherwise throw on the first login rather than at boot.
 */
const JWT_TTL_PATTERN = /^\d+(\s*(ms|s|m|h|d|w|y|sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|year|years))?$/i;

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: string;
  /**
   * How long a refresh token stays valid, in days. CLAUDE.md §1 says "~30-day
   * refresh token".
   *
   * There is deliberately no JWT_REFRESH_SECRET: refresh tokens are OPAQUE random
   * strings, not JWTs (see the refresh_token table and AuthService), so there is
   * nothing to sign. A signing secret would be dead configuration that implies a
   * design this code does not use. .env.example documents the switch.
   *
   * Capped at a year: a refresh token is a long-lived credential, and "remember
   * me forever" is a footgun, not a feature.
   */
  REFRESH_TOKEN_TTL_DAYS: number;
  BCRYPT_COST: number;
  LOGIN_THROTTLE_LIMIT: number;
  LOGIN_THROTTLE_TTL_SECONDS: number;
  /**
   * Signup rate limit: SIGNUP_THROTTLE_LIMIT orgs per SIGNUP_THROTTLE_TTL_SECONDS
   * per source IP. Keyed on IP alone (via SignupThrottlerGuard) because signup is
   * unauthenticated and there is no account yet to key on — see the guard.
   *
   * Env-configurable for the same reason LOGIN_THROTTLE_LIMIT is: the e2e suite
   * creates far more than a real hour's worth of orgs from one IP, so its jest
   * setup raises this out of the way (test/helpers/test-env.ts). A hardcoded
   * limit would force a choice between an unrealistically high production default
   * and a red test suite.
   */
  SIGNUP_THROTTLE_LIMIT: number;
  SIGNUP_THROTTLE_TTL_SECONDS: number;
  /**
   * Whether to mount the interactive Swagger UI at /api/docs.
   *
   * Defaults to on outside production and off in it. The page is unauthenticated
   * — SwaggerModule mounts Express middleware, so the global JwtAuthGuard never
   * sees those requests — and it enumerates every route, DTO field, and
   * validation rule in the API. That is exactly what makes it useful in
   * development and what makes it reconnaissance in production. Turning it on
   * there has to be a deliberate, greppable act.
   */
  API_DOCS_ENABLED: boolean;
  /**
   * How long an issued passcode stays valid. CLAUDE.md §1 says "~72h".
   *
   * Capped at a week: a passcode is a single-factor credential sitting in an
   * inbox, and its whole security argument is that the window is short.
   */
  PASSCODE_TTL_HOURS: number;
  /**
   * How invite email is delivered.
   *
   * `console` renders the message to the log — including the passcode, which is
   * exactly why validateEnv() refuses to boot production with it. `smtp` is not
   * implemented yet (task #8); it is accepted as a value here only so the
   * refusal message can be specific about that rather than reading as a typo.
   */
  MAIL_DRIVER: MailDriver;
  /** From-address on invite email. Unused by the console driver. */
  MAIL_FROM: string;
  /** Absolute base URL used to build the invite link. */
  APP_BASE_URL: string;
  /** SMTP host for outbound mail when MAIL_DRIVER=smtp. */
  SMTP_HOST?: string;
  /** SMTP port (typically 587 for TLS, 465 for SSL). Defaults to 587. */
  SMTP_PORT?: number;
  /** Whether to use TLS/SSL directly (true for 465, false for 587/STARTTLS). */
  SMTP_SECURE?: boolean;
  /** SMTP username or API key name (e.g. "resend" or "apikey"). */
  SMTP_USER?: string;
  /** SMTP password or API token. */
  SMTP_PASS?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_STORAGE_BUCKET?: string;
}

export type MailDriver = 'console' | 'smtp';

function fail(problems: string[]): never {
  throw new Error(
    `Invalid environment — refusing to start.\n\n` +
      problems.map((p) => `  • ${p}`).join('\n') +
      `\n\nSee .env.example. Copy it to apps/api/.env and fill in real values.\n`,
  );
}

function requireSecret(name: string, raw: string | undefined, problems: string[]): string {
  if (!raw) {
    problems.push(`${name} is not set.`);
    return '';
  }
  const lower = raw.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((m) => lower.includes(m))) {
    problems.push(
      `${name} is still the placeholder from .env.example. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`,
    );
  } else if (raw.length < MIN_SECRET_LENGTH) {
    problems.push(
      `${name} is ${raw.length} chars; needs at least ${MIN_SECRET_LENGTH} to not be brute-forceable.`,
    );
  }
  return raw;
}

function intInRange(
  name: string,
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
  problems: string[],
): number {
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    problems.push(`${name} must be an integer, got "${raw}".`);
    return def;
  }
  if (n < min || n > max) {
    problems.push(`${name} must be between ${min} and ${max}, got ${n}.`);
    return def;
  }
  return n;
}

/**
 * Parse an explicit boolean, falling back to `def` when unset or empty.
 *
 * Only "true"/"1" and "false"/"0" are accepted. Anything else is a problem
 * rather than a silent falsy — "no", "off", or a typo'd "ture" quietly meaning
 * false is precisely how a flag that gates an unauthenticated docs page ends up
 * in the wrong state.
 */
function boolOrDefault(
  name: string,
  raw: string | undefined,
  def: boolean,
  problems: string[],
): boolean {
  if (raw === undefined || raw.trim() === '') return def;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  problems.push(`${name} must be true or false, got "${raw}".`);
  return def;
}

export function validateEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const problems: string[] = [];

  const nodeEnv = (source.NODE_ENV ?? 'development') as AppEnv['NODE_ENV'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    problems.push(`NODE_ENV must be development | test | production, got "${nodeEnv}".`);
  }

  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) {
    problems.push('DATABASE_URL is not set.');
  } else if (/(^|[:/@])relay_migrator([:@]|$)/.test(databaseUrl)) {
    // The runtime must never connect as the schema owner. FORCE RLS covers this
    // at the database level, but connecting as the migrator would still hand the
    // app DDL rights it has no business holding.
    problems.push(
      'DATABASE_URL connects as relay_migrator. The runtime must use relay_app — ' +
        'the migrator owns the schema and holds DDL rights.',
    );
  }

  const accessSecret = requireSecret(
    'JWT_ACCESS_SECRET',
    source.JWT_ACCESS_SECRET,
    problems,
  );

  // bcrypt: 12 is the project default. Below 10 is too fast to be worth much;
  // above 15 will make request latency obvious.
  const bcryptCost = intInRange('BCRYPT_COST', source.BCRYPT_COST, 12, 10, 15, problems);

  const accessTtl = source.JWT_ACCESS_TTL ?? '15m';
  if (!JWT_TTL_PATTERN.test(accessTtl.trim())) {
    problems.push(
      `JWT_ACCESS_TTL must be a duration like "15m", "24h", or a number of seconds — got "${accessTtl}".`,
    );
  }

  // --- Mail driver validation ---------------------------------------------
  const mailDriver = (source.MAIL_DRIVER ?? 'console').trim().toLowerCase();
  if (mailDriver !== 'console' && mailDriver !== 'smtp') {
    problems.push(`MAIL_DRIVER must be "console" or "smtp", got "${source.MAIL_DRIVER}".`);
  }

  const mailFrom = source.MAIL_FROM ?? '';
  let smtpHost: string | undefined;
  let smtpPort: number | undefined;
  let smtpSecure: boolean | undefined;
  let smtpUser: string | undefined;
  let smtpPass: string | undefined;

  if (mailDriver === 'smtp') {
    if (!mailFrom.trim()) {
      problems.push('MAIL_FROM is required when MAIL_DRIVER=smtp.');
    } else {
      const emailPattern = /^([^<]+<)?\s*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*>?$/;
      if (!emailPattern.test(mailFrom.trim())) {
        problems.push(`MAIL_FROM is not a valid email address format: "${mailFrom}".`);
      }
      if (isPlaceholder(mailFrom)) {
        problems.push(`MAIL_FROM contains a documentation placeholder: "${mailFrom}".`);
      }
    }

    const rawHost = source.SMTP_HOST?.trim();
    if (!rawHost) {
      problems.push('SMTP_HOST is required when MAIL_DRIVER=smtp.');
    } else if (
      isPlaceholder(rawHost) ||
      rawHost.includes('example.com') ||
      rawHost.includes('your-smtp-host')
    ) {
      problems.push(`SMTP_HOST contains a documentation placeholder: "${rawHost}".`);
    } else {
      smtpHost = rawHost;
    }

    smtpPort = intInRange('SMTP_PORT', source.SMTP_PORT, 587, 1, 65535, problems);
    smtpSecure = boolOrDefault('SMTP_SECURE', source.SMTP_SECURE, smtpPort === 465, problems);

    const rawUser = source.SMTP_USER?.trim();
    if (!rawUser) {
      problems.push('SMTP_USER is required when MAIL_DRIVER=smtp.');
    } else if (isPlaceholder(rawUser)) {
      problems.push(`SMTP_USER contains a documentation placeholder: "${rawUser}".`);
    } else {
      smtpUser = rawUser;
    }

    const rawPass = source.SMTP_PASS?.trim();
    if (!rawPass) {
      problems.push('SMTP_PASS is required when MAIL_DRIVER=smtp.');
    } else if (isPlaceholder(rawPass)) {
      problems.push(`SMTP_PASS contains a documentation placeholder.`);
    } else {
      smtpPass = rawPass;
    }

    // Provider-specific vs Generic SMTP validation
    if (smtpHost && smtpUser && smtpPass) {
      const lowerHost = smtpHost.toLowerCase();
      const isResend = lowerHost.includes('resend.com');
      const isSendGrid = lowerHost.includes('sendgrid.net');
      const isPostmark = lowerHost.includes('postmarkapp.com');

      if (isResend) {
        if (smtpUser !== 'resend') {
          problems.push(
            `For Resend SMTP (host: ${smtpHost}), SMTP_USER must be "resend", got "${smtpUser}".`,
          );
        }
        if (!smtpPass.startsWith('re_') || smtpPass.length < 24) {
          problems.push(
            `For Resend SMTP (host: ${smtpHost}), SMTP_PASS must start with "re_" and be at least 24 characters.`,
          );
        }
      } else if (isSendGrid) {
        if (smtpUser !== 'apikey') {
          problems.push(
            `For SendGrid SMTP (host: ${smtpHost}), SMTP_USER must be "apikey", got "${smtpUser}".`,
          );
        }
        if (!smtpPass.startsWith('SG.') || smtpPass.length < 60) {
          problems.push(
            `For SendGrid SMTP (host: ${smtpHost}), SMTP_PASS must start with "SG." and be a valid SendGrid API key.`,
          );
        }
      } else if (isPostmark) {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(smtpPass)) {
          problems.push(
            `For Postmark SMTP (host: ${smtpHost}), SMTP_PASS must be a valid Postmark Server API Token (UUID).`,
          );
        }
      } else {
        // Generic / Custom SMTP branch ONLY (e.g. self-hosted, AWS SES, Gmail, Mailgun)
        if (smtpPass.length < 8) {
          problems.push(`SMTP_PASS must be at least 8 characters.`);
        }
        const weakPasswords = ['password', '12345678', 'admin', 'secret', 'relay'];
        if (weakPasswords.includes(smtpPass.toLowerCase())) {
          problems.push(`SMTP_PASS cannot be a trivial password like "${smtpPass}".`);
        }
      }
    }
  }

  // --- APP_BASE_URL validation ---------------------------------------------
  const appBaseUrl = source.APP_BASE_URL;
  if (!appBaseUrl) {
    problems.push('APP_BASE_URL is not set.');
  } else {
    try {
      const url = new URL(appBaseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        problems.push(`APP_BASE_URL must be http(s), got "${url.protocol}".`);
      }
    } catch {
      problems.push(`APP_BASE_URL is not a valid URL: "${appBaseUrl}".`);
    }
  }

  const env: AppEnv = {
    NODE_ENV: nodeEnv,
    PORT: intInRange('PORT', source.PORT, 3000, 1, 65535, problems),
    DATABASE_URL: databaseUrl ?? '',
    JWT_ACCESS_SECRET: accessSecret,
    JWT_ACCESS_TTL: accessTtl.trim(),
    // ~30 days, per CLAUDE.md §1. Capped at a year — a refresh token is a
    // long-lived credential and "remember me forever" is a footgun.
    REFRESH_TOKEN_TTL_DAYS: intInRange(
      'REFRESH_TOKEN_TTL_DAYS',
      source.REFRESH_TOKEN_TTL_DAYS,
      30,
      1,
      365,
      problems,
    ),
    BCRYPT_COST: bcryptCost,
    // 5 attempts / 15 min, per the login-throttling decision.
    LOGIN_THROTTLE_LIMIT: intInRange(
      'LOGIN_THROTTLE_LIMIT',
      source.LOGIN_THROTTLE_LIMIT,
      5,
      1,
      1000,
      problems,
    ),
    LOGIN_THROTTLE_TTL_SECONDS: intInRange(
      'LOGIN_THROTTLE_TTL_SECONDS',
      source.LOGIN_THROTTLE_TTL_SECONDS,
      900,
      1,
      86_400,
      problems,
    ),
    // 10 signups / hour / IP by default. The upper bound is deliberately huge
    // (10 million) rather than a tidy number: the e2e suite's jest setup sets
    // this to 1_000_000 to lift the limit clear of a run that creates dozens of
    // orgs from one IP, and intInRange would reject that as out of range with a
    // tighter cap. No production deployment wants a real limit that high, but
    // the validator's job is to reject nonsense, not to second-guess a value the
    // operator explicitly set.
    SIGNUP_THROTTLE_LIMIT: intInRange(
      'SIGNUP_THROTTLE_LIMIT',
      source.SIGNUP_THROTTLE_LIMIT,
      10,
      1,
      10_000_000,
      problems,
    ),
    SIGNUP_THROTTLE_TTL_SECONDS: intInRange(
      'SIGNUP_THROTTLE_TTL_SECONDS',
      source.SIGNUP_THROTTLE_TTL_SECONDS,
      3600,
      1,
      86_400,
      problems,
    ),
    // Off by default in production, on everywhere else. Opting in on production
    // is allowed but must be explicit — see the warning emitted in main.ts.
    API_DOCS_ENABLED: boolOrDefault(
      'API_DOCS_ENABLED',
      source.API_DOCS_ENABLED,
      nodeEnv !== 'production',
      problems,
    ),
    PASSCODE_TTL_HOURS: intInRange(
      'PASSCODE_TTL_HOURS',
      source.PASSCODE_TTL_HOURS,
      72,
      1,
      168,
      problems,
    ),
    MAIL_DRIVER: mailDriver as MailDriver,
    MAIL_FROM: mailFrom.trim(),
    APP_BASE_URL: appBaseUrl ?? '',
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_SECURE: smtpSecure,
    SMTP_USER: smtpUser,
    SMTP_PASS: smtpPass,
    SUPABASE_URL: source.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET: source.SUPABASE_STORAGE_BUCKET || 'task-attachments',
  };

  if (problems.length > 0) fail(problems);
  return env;
}

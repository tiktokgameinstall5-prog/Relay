/**
 * Manual smoke test for the plan's verification section: signup -> login -> /me,
 * plus a decode of the access token to confirm an Owner carries managerId: null.
 *
 * Deliberately hand-run against a booted server rather than folded into the e2e
 * suite: the point is to exercise the real compiled build over real HTTP, which
 * is exactly what ts-jest's in-process app does not do.
 *
 *   node dist/main.js &
 *   node test/manual/smoke.mjs
 */
const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api';
const email = `smoke-owner-${Date.now()}@relay.test`;
const password = 'correct horse battery staple';

let failures = 0;

function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Decode without verifying — this checks claim *shape*, not authenticity. */
function decodeClaims(token) {
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

const signup = await call('POST', '/auth/owner/signup', {
  body: { organizationName: 'Smoke Test Co', name: 'Smoke Owner', email, password },
});
check('signup returns 201', signup.status === 201, `got ${signup.status} ${JSON.stringify(signup.body)}`);
check('signup returns an access token', typeof signup.body?.accessToken === 'string');
check('signup echoes role owner', signup.body?.user?.role === 'owner');

const login = await call('POST', '/auth/owner/login', { body: { email, password } });
check('login returns 200', login.status === 200, `got ${login.status} ${JSON.stringify(login.body)}`);

const token = login.body?.accessToken;
check('login returns an access token', typeof token === 'string');

const claims = decodeClaims(token);
check('token managerId is null for an Owner', claims.managerId === null, `managerId=${JSON.stringify(claims.managerId)}`);
check('token role is owner', claims.role === 'owner');
check('token carries sub and orgId', Boolean(claims.sub && claims.orgId));
check(
  'token carries no claims beyond sub/role/orgId/managerId/iat/exp',
  Object.keys(claims).sort().join(',') === 'exp,iat,managerId,orgId,role,sub',
  Object.keys(claims).sort().join(','),
);

const me = await call('GET', '/me', { token });
check('GET /me with token returns 200', me.status === 200, `got ${me.status} ${JSON.stringify(me.body)}`);
check('/me returns the caller', me.body?.email === email.toLowerCase());
check('/me managerId is null', me.body?.managerId === null);
check('/me organizationName is set', me.body?.organizationName === 'Smoke Test Co');
check(
  '/me leaks no hash fields',
  !('password_hash' in (me.body ?? {})) && !('passcode_hash' in (me.body ?? {})),
);

const anon = await call('GET', '/me');
check('GET /me without a token returns 401', anon.status === 401, `got ${anon.status}`);

const wrong = await call('POST', '/auth/owner/login', { body: { email, password: 'wrong-password' } });
check('login with a wrong password returns 401', wrong.status === 401, `got ${wrong.status}`);

console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

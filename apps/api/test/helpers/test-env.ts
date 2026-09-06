/**
 * Jest setupFiles hook — runs ONCE per worker, before any test module (and so
 * before AppModule and its ConfigModule) is imported.
 *
 * Why this exists: the e2e suite creates far more organizations from a single
 * source IP than a real hour ever would — freshEmail() spins up dozens of
 * signups per run. The production signup throttle (10 / hour / IP) would turn
 * that into a wall of 429s partway through the suite, so we lift the limit out
 * of the way for tests that are not specifically about throttling.
 *
 * Why setupFiles and not setupFilesAfterEach or an inline override: appConfig()
 * calls validateEnv() when ConfigModule loads it, which happens the first time a
 * spec imports AppModule. setupFiles is the only hook guaranteed to run before
 * that import, so the raised value is in process.env by the time the config is
 * frozen. A later hook would be reading an already-validated env.
 *
 * The one test that IS about the throttle biting (signup-throttle spec) builds
 * its own AppModule in a beforeAll with a low SIGNUP_THROTTLE_LIMIT set locally,
 * then restores this value — so this default and that test do not fight.
 *
 * This does not touch LOGIN_THROTTLE_LIMIT: auth.e2e-spec pins the login
 * throttle at its real default of 5 and asserts the 6th attempt is refused.
 */
process.env.SIGNUP_THROTTLE_LIMIT = '1000000';
process.env.MAIL_DRIVER = 'console';

// Ensure test runner always targets the dedicated relay_test database
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(/\/relay(\?.*)?$/, '/relay_test$1');
}
if (process.env.MIGRATION_DATABASE_URL) {
  process.env.MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL.replace(/\/relay(\?.*)?$/, '/relay_test$1');
}

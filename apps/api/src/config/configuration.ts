/**
 * @nestjs/config wiring.
 *
 * The factory returns the already-validated AppEnv, so nothing downstream has to
 * parse strings or apply defaults a second time. Anything reading config gets
 * numbers as numbers and can trust the values are present.
 */
import { validateEnv, type AppEnv } from './env.validation';

export const CONFIG_NAMESPACE = 'app';

/** Registered via `ConfigModule.forRoot({ load: [appConfig] })`. */
export function appConfig(): { [CONFIG_NAMESPACE]: AppEnv } {
  return { [CONFIG_NAMESPACE]: validateEnv() };
}

/**
 * Typed accessor. `ConfigService.get('app')` returns `AppEnv | undefined`, and
 * every call site would otherwise repeat the same non-null assertion — but by
 * the time anything is injected, validateEnv() has either populated this or
 * thrown during module init, so the assertion is sound exactly once, here.
 */
export function appEnv(config: {
  get<T>(key: string): T | undefined;
}): AppEnv {
  const env = config.get<AppEnv>(CONFIG_NAMESPACE);
  if (!env) {
    throw new Error(
      'App config is missing. ConfigModule.forRoot({ load: [appConfig] }) must run before this.',
    );
  }
  return env;
}

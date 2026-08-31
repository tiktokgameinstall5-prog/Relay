import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // Runs before any spec (and so before AppModule/ConfigModule) is imported:
  // lifts the signup throttle clear of a suite that creates many orgs from one
  // IP. See the file header for why this hook and not a later one.
  setupFiles: ['./test/helpers/test-env.ts'],
  globalSetup: './test/helpers/global-setup.ts',
  globalTeardown: './test/helpers/global-teardown.ts',
  testTimeout: 60000,
};

export default config;

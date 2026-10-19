import { describe, expect, it } from 'vitest';
import { resolvePoolConfig } from './pool-config.js';

describe('resolvePoolConfig', () => {
  it('usa los defaults sin variables', () => {
    expect(resolvePoolConfig({})).toEqual({
      max: 8,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
  });

  it('lee las variables del entorno', () => {
    expect(
      resolvePoolConfig({
        DB_POOL_MAX: '5',
        DB_CONNECTION_TIMEOUT_MS: '2000',
        DB_STATEMENT_TIMEOUT_MS: '60000',
      }),
    ).toEqual({ max: 5, connectionTimeoutMillis: 2000, statement_timeout: 60000 });
  });

  it.each(['0', '-1', 'abc', '1.5', '8 '])('rechaza DB_POOL_MAX="%s"', (v) => {
    expect(() => resolvePoolConfig({ DB_POOL_MAX: v })).toThrow(/DB_POOL_MAX/);
  });
});

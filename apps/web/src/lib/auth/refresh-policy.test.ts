import { describe, expect, it } from 'vitest';
import { decidirTrasFalloRefresh, retryDelayMs } from './refresh-policy';

describe('decidirTrasFalloRefresh', () => {
  it.each([400, 401, 403, 404, 422])('status %s (4xx definitivo) cierra sesión', (status) => {
    expect(decidirTrasFalloRefresh(status)).toBe('logout');
  });

  it.each([null, 408, 429, 500, 502, 503])('status %s conserva la sesión y reintenta', (status) => {
    expect(decidirTrasFalloRefresh(status)).toBe('retry');
  });
});

describe('retryDelayMs', () => {
  it('5 s, 15 s, 30 s y luego 60 s', () => {
    expect([0, 1, 2, 3, 10].map(retryDelayMs)).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
  });
});

import { describe, expect, it } from 'vitest';
import { decidirTrasFalloRefresh, retryDelayMs } from './refresh-policy';

describe('decidirTrasFalloRefresh', () => {
  it('401 cierra sesión', () => {
    expect(decidirTrasFalloRefresh(401)).toBe('logout');
  });

  it.each([null, 500, 502, 503, 429, 403])('status %s conserva la sesión y reintenta', (status) => {
    expect(decidirTrasFalloRefresh(status)).toBe('retry');
  });
});

describe('retryDelayMs', () => {
  it('5 s, 15 s, 30 s y luego 60 s', () => {
    expect([0, 1, 2, 3, 10].map(retryDelayMs)).toEqual([5_000, 15_000, 30_000, 60_000, 60_000]);
  });
});

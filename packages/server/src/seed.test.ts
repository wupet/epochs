import { describe, expect, it } from 'vitest';
import { parseSeed } from './seed';

describe('parseSeed', () => {
  it.each([
    ['0', 0],
    ['7', 7],
    ['4294967295', 4294967295],
  ])('accepts %s', (text, seed) => {
    expect(parseSeed(text)).toBe(seed);
  });

  it.each(['', ' ', '-1', '1.5', '4294967296', 'abc', '1e3', '0x10', '12 ', '+5'])('rejects %j', (text) => {
    expect(parseSeed(text)).toBeNull();
  });
});

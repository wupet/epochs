import { describe, expect, it } from 'vitest';
import { describeClient } from './describe';

describe('client', () => {
  it('reads the tick length from the shared package', () => {
    expect(describeClient()).toBe('Epochs client (tick 250 ms)');
  });
});

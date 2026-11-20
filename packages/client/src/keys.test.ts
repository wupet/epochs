import { describe, expect, it } from 'vitest';
import { clickAction, isFormControl } from './keys';

describe('isFormControl', () => {
  it('is true for input, select, textarea and button, in any case', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'button', 'Select']) {
      expect(isFormControl({ tagName })).toBe(true);
    }
  });

  it('is false for the canvas, the body, and anything that is not an element', () => {
    for (const target of [{ tagName: 'CANVAS' }, { tagName: 'BODY' }, {}, { tagName: 5 }, null, undefined, 'BUTTON']) {
      expect(isFormControl(target)).toBe(false);
    }
  });
});

describe('clickAction', () => {
  it('attacks an enemy on the tile, armed or not', () => {
    expect(clickAction(false, 7)).toEqual({ kind: 'attack', enemyId: 7 });
    expect(clickAction(true, 7)).toEqual({ kind: 'attack', enemyId: 7 });
  });

  it('attack-moves on an empty tile when armed, and moves when not', () => {
    expect(clickAction(true, undefined)).toEqual({ kind: 'attack-move' });
    expect(clickAction(false, undefined)).toEqual({ kind: 'move' });
  });
});

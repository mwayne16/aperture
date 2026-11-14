import { describe, expect, it } from 'vitest';
import { nextListIndex } from './listNavigation';

describe('nextListIndex', () => {
  it('moves one step with the arrows and stops at the ends', () => {
    expect(nextListIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextListIndex('ArrowDown', 2, 3)).toBe(2);
    expect(nextListIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextListIndex('ArrowUp', 0, 3)).toBe(0);
  });

  it('jumps to the first and last item with Home and End', () => {
    expect(nextListIndex('Home', 2, 3)).toBe(0);
    expect(nextListIndex('End', 0, 3)).toBe(2);
  });

  it('ignores other keys and empty lists', () => {
    expect(nextListIndex('Enter', 0, 3)).toBeNull();
    expect(nextListIndex('ArrowDown', 0, 0)).toBeNull();
  });
});

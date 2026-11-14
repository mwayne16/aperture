/**
 * Where a navigation key moves focus in a vertical list of `count` items, or null when the key
 * doesn't navigate. Stops at the ends instead of wrapping.
 */
export function nextListIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(index + 1, count - 1);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

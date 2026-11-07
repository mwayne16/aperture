import { describe, expect, it } from 'vitest';

/*
 * The sidebar must work in both themes, so every color in watchlists.css comes from a theme token.
 * Vitest runs with `css: false`, so the stylesheet is read from disk.
 */
interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;
const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
if (!dirname) throw new Error('import.meta.dirname unavailable');

const css = fs.readFileSync(`${dirname}/watchlists.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const declarations = css.match(/[a-z-]+\s*:[^;{}]+/g) ?? [];

describe('watchlists.css', () => {
  it('uses theme tokens for every color', () => {
    const colors = declarations.filter((d) =>
      /^(color|background|border(?!-radius)|outline|fill|stroke)/.test(d),
    );
    expect(colors.length).toBeGreaterThan(5);
    for (const declaration of colors) {
      expect(declaration).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black)\b/i);
    }
  });
});

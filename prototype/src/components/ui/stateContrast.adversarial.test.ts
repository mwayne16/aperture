import { describe, expect, it } from 'vitest';

/*
 * The spec requires gain/loss and muted text at 4.5:1, a dense quote table with gain/loss coloring
 * and a selected row, and consistent hover/selected states. The showcase renders the Chg% column
 * as a soft Badge inside each row, and any row can be selected, so the badge text must stay
 * legible on its tint over a selected or hovered row, not just over the bare panel. Selected
 * states must also never read weaker than hover. Vitest runs with `css: false`, so CSS is read
 * from disk.
 */
interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;
const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
if (!dirname) throw new Error('import.meta.dirname unavailable');

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = strip(fs.readFileSync(`${dirname}/../../styles/tokens.css`, 'utf8'));
const uiCss = strip(fs.readFileSync(`${dirname}/ui.css`, 'utf8'));

interface Rule {
  selectors: string[];
  body: string;
}

function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, '"').replace(/\s+/g, ' ')),
    body: m[2] ?? '',
  }));
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of body.split(';')) {
    const i = decl.indexOf(':');
    if (i >= 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

function themeTokens(theme: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {};
  const all = rules(tokensCss);
  for (const r of all) if (r.selectors.includes(':root')) Object.assign(out, declarations(r.body));
  if (theme === 'light')
    for (const r of all)
      if (r.selectors.includes(':root[data-theme="light"]')) Object.assign(out, declarations(r.body));
  return out;
}

/** The last value of `property` declared for an exact selector in ui.css. */
function declared(selector: string, property: string): string {
  let found: string | undefined;
  for (const r of rules(uiCss)) {
    if (!r.selectors.includes(selector)) continue;
    const decls = declarations(r.body);
    found = decls[property] ?? (property === 'background-color' ? decls.background : undefined) ?? found;
  }
  if (!found) throw new Error(`no ${property} for ${selector}`);
  return found;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function resolve(tokens: Record<string, string>, value: string): string {
  let v = value.trim();
  for (let i = 0; i < 10; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m?.[1]) return v;
    const next = tokens[m[1]];
    if (next === undefined) throw new Error(`missing token ${m[1]}`);
    v = next.trim();
  }
  return v;
}

function parse(value: string): Rgba {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{6})$/.exec(v)?.[1];
  if (hex) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v)?.[1];
  if (fn) {
    const [r = 0, g = 0, b = 0, a = 1] = fn.split(',').map((n) => Number(n.trim()));
    return { r, g, b, a };
  }
  throw new Error(`unparsed color ${value}`);
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(['dark', 'light'] as const)('soft Badge legibility, %s theme (adversarial)', (theme) => {
  const tokens = themeTokens(theme);
  const color = (value: string) => parse(resolve(tokens, value));
  const panel = color('var(--bg-panel)');
  const surfaces: Record<string, Rgba> = {
    panel,
    'selected row': over(color('var(--bg-selected)'), panel),
    'hovered row': over(color('var(--bg-hover)'), panel),
  };

  // The quote table's Chg% badge uses these three tones; muted marks an unchanged quote.
  it.each([
    ['gain', 'panel'],
    ['loss', 'panel'],
    ['muted', 'panel'],
    ['gain', 'selected row'],
    ['loss', 'selected row'],
    ['muted', 'selected row'],
    ['gain', 'hovered row'],
    ['loss', 'hovered row'],
    ['muted', 'hovered row'],
  ])('%s badge text on its tint over a %s is at least 4.5:1', (tone, surface) => {
    const selector = `.ui-badge--soft.ui-badge--${tone}`;
    const base = surfaces[surface];
    if (!base) throw new Error(surface);
    const fill = over(color(declared(selector, 'background-color')), base);
    const text = color(declared(selector, 'color'));
    expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['neutral', 'accent', 'warning'])('%s soft badge text is at least 4.5:1 on the panel', (tone) => {
    const selector = `.ui-badge--soft.ui-badge--${tone}`;
    const fill = over(color(declared(selector, 'background-color')), panel);
    expect(contrast(color(declared(selector, 'color')), fill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['neutral', 'muted', 'accent', 'gain', 'loss', 'warning'])(
    '%s solid badge text is at least 4.5:1 on its fill',
    (tone) => {
      const selector = `.ui-badge--solid.ui-badge--${tone}`;
      const fill = over(color(declared(selector, 'background-color')), panel);
      expect(contrast(color(declared(selector, 'color')), fill)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe.each(['dark', 'light'] as const)(
  'SegmentedControl selected state, %s theme (adversarial)',
  (theme) => {
    const tokens = themeTokens(theme);
    const color = (value: string) => parse(resolve(tokens, value));

    it('the selected segment stands out from the track at least as much as a hovered one', () => {
      const track = color(declared('.ui-segmented', 'background-color'));
      const selected = over(color(declared('.ui-segmented__item.is-selected', 'background-color')), track);
      const hovered = over(
        color(declared('.ui-segmented__item:hover:not(:disabled):not(.is-selected)', 'background-color')),
        track,
      );
      // A hovered option must never look more "chosen" than the chosen one.
      expect(contrast(selected, track)).toBeGreaterThanOrEqual(contrast(hovered, track));
    });
  },
);

import { describe, expect, it } from 'vitest';
import tokensRaw from '../../styles/tokens.css?raw';
import { FALLBACK_THEME_COLORS, THEME_COLOR_VARS } from './theme';

/*
 * Parses tokens.css and checks WCAG contrast for both themes.
 *
 * Vitest is configured with `css: false`, which empties every .css import, including `?raw`.
 * When that happens the source is read from disk instead (Node is available in the test
 * runner). If the config ever enables raw CSS for this file, the `?raw` import is used as is.
 */
async function loadTokensSource(): Promise<string> {
  if (tokensRaw.trim() !== '') return tokensRaw;
  const fsModule = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsModule)) as {
    readFileSync: (path: string, encoding: 'utf8') => string;
  };
  // The jsdom environment replaces the global URL class, which Node's fs rejects, so build a path.
  const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
  if (!dirname) throw new Error('import.meta.dirname is unavailable; cannot locate tokens.css');
  return fs.readFileSync(`${dirname}/../../styles/tokens.css`, 'utf8');
}

const source = await loadTokensSource();

/* ------------------------------------------------------------------ parsing */

type TokenMap = Record<string, string>;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns the declarations of every top-level rule, keyed by its normalized selector list. */
function parseRules(css: string): { selectors: string[]; decls: TokenMap }[] {
  const rules: { selectors: string[]; decls: TokenMap }[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripComments(css).matchAll(ruleRe)) {
    const selectors = (match[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/'/g, '"').replace(/\s+/g, ''))
      .filter(Boolean);
    const decls: TokenMap = {};
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon < 0) continue;
      const name = decl.slice(0, colon).trim();
      if (name.startsWith('--')) decls[name] = decl.slice(colon + 1).trim();
    }
    rules.push({ selectors, decls });
  }
  return rules;
}

/** Tokens in effect for <html data-theme="..."> (bare :root rules apply in both themes). */
function themeTokens(css: string, theme: 'dark' | 'light'): TokenMap {
  const tokens: TokenMap = {};
  for (const rule of parseRules(css)) {
    if (rule.selectors.includes(':root')) Object.assign(tokens, rule.decls);
  }
  for (const rule of parseRules(css)) {
    if (rule.selectors.includes(`:root[data-theme="${theme}"]`)) Object.assign(tokens, rule.decls);
  }
  return tokens;
}

function resolveVar(tokens: TokenMap, name: string, depth = 0): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`Missing token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (ref?.[1] && depth < 10) return resolveVar(tokens, ref[1], depth + 1);
  return value;
}

/* ------------------------------------------------------------------ color math */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value)?.[1];
  if (fn) {
    const parts = fn
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    const [r, g, b, a = 1] = parts;
    if ([r, g, b, a].some((v) => v === undefined || Number.isNaN(v))) throw new Error(`Bad color ${input}`);
    return { r: r!, g: g!, b: b!, a: a };
  }
  throw new Error(`Unsupported color ${input}`);
}

/** Composites `top` over an opaque `bottom`. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ------------------------------------------------------------------ tests */

describe('color helpers', () => {
  it('computes the WCAG extremes and identity', () => {
    expect(contrast(parseColor('#000'), parseColor('#fff'))).toBeCloseTo(21, 5);
    expect(contrast(parseColor('#777777'), parseColor('#777777'))).toBe(1);
  });

  it('parses hex, rgb and rgba in comma and space syntax', () => {
    expect(parseColor('#0F141B')).toEqual({ r: 15, g: 20, b: 27, a: 1 });
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('rgba(52, 211, 153, 0.14)')).toEqual({ r: 52, g: 211, b: 153, a: 0.14 });
    expect(parseColor('rgb(1 2 3 / 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(() => parseColor('hsl(0 0% 0%)')).toThrow();
    expect(() => parseColor('#12')).toThrow();
  });

  it('composites translucent colors', () => {
    const half = over(parseColor('rgba(255, 255, 255, 0.5)'), parseColor('#000000'));
    expect(half.r).toBeCloseTo(127.5);
    expect(half.a).toBe(1);
  });

  it('resolves var() aliases and reports missing tokens', () => {
    const tokens = { '--a': 'var(--b)', '--b': '#fff' };
    expect(resolveVar(tokens, '--a')).toBe('#fff');
    expect(() => resolveVar(tokens, '--nope')).toThrow(/Missing token/);
  });

  it('applies bare :root rules to both themes and theme rules only to their theme', () => {
    const css = `:root, :root[data-theme='dark'] { --x: #000; --y: #111; }
      :root[data-theme="light"] { --x: #fff; } :root { --z: 1px; } .other { --x: #f00; }`;
    expect(themeTokens(css, 'dark')).toEqual({ '--x': '#000', '--y': '#111', '--z': '1px' });
    expect(themeTokens(css, 'light')).toEqual({ '--x': '#fff', '--y': '#111', '--z': '1px' });
  });
});

describe.each(['dark', 'light'] as const)('tokens.css — %s theme', (theme) => {
  const tokens = themeTokens(source, theme);
  const color = (name: string) => parseColor(resolveVar(tokens, name));
  const panel = color('--bg-panel');
  const app = color('--bg-app');

  it('defines every required token', () => {
    const required = [
      '--bg-app',
      '--bg-chrome',
      '--bg-panel',
      '--bg-raised',
      '--bg-input',
      '--bg-hover',
      '--bg-selected',
      '--border',
      '--border-strong',
      '--text-primary',
      '--text-muted',
      '--text-faint',
      '--accent',
      '--accent-hover',
      '--text-on-accent',
      '--gain',
      '--loss',
      '--gain-tint',
      '--loss-tint',
      '--warning',
      '--warning-tint',
      '--focus-ring',
      '--shadow-window',
      '--shadow-popover',
      '--font-ui',
      '--font-mono',
      '--fs-xs',
      '--fs-sm',
      '--fs-md',
      '--fs-lg',
      '--fs-xl',
      '--fs-2xl',
      '--sp-1',
      '--sp-2',
      '--sp-3',
      '--sp-4',
      '--sp-5',
      '--sp-6',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--h-control-sm',
      '--h-control',
      '--h-row',
      '--h-topbar',
      '--h-panel-header',
      '--dur-fast',
    ];
    expect(required.filter((name) => !(name in tokens))).toEqual([]);
  });

  it('keeps the specified sizes', () => {
    expect([tokens['--fs-md'], tokens['--h-control'], tokens['--h-row'], tokens['--h-topbar']]).toEqual([
      '14px',
      '34px',
      '40px',
      '56px',
    ]);
    expect([tokens['--sp-1'], tokens['--sp-6'], tokens['--radius-md'], tokens['--dur-fast']]).toEqual([
      '4px',
      '24px',
      '8px',
      '120ms',
    ]);
  });

  it('uses opaque surfaces and text colors', () => {
    for (const name of [
      '--bg-app',
      '--bg-chrome',
      '--bg-panel',
      '--bg-raised',
      '--bg-input',
      '--text-primary',
      '--text-muted',
      '--text-faint',
      '--accent',
      '--gain',
      '--loss',
      '--warning',
    ]) {
      expect(color(name).a, name).toBe(1);
    }
  });

  it.each([
    ['--text-primary', '--bg-panel', 4.5],
    ['--text-primary', '--bg-app', 4.5],
    ['--text-muted', '--bg-panel', 4.5],
    ['--text-muted', '--bg-app', 4.5],
    ['--text-primary', '--bg-raised', 4.5],
    ['--text-muted', '--bg-raised', 4.5],
    ['--text-primary', '--bg-chrome', 4.5],
    ['--gain', '--bg-panel', 4.5],
    ['--loss', '--bg-panel', 4.5],
    ['--accent-text', '--bg-panel', 4.5],
    ['--text-on-accent', '--accent', 4.5],
    ['--text-on-accent', '--accent-hover', 4.5],
    ['--text-on-accent', '--danger', 4.5],
    ['--text-on-accent', '--danger-hover', 4.5],
    ['--text-on-accent', '--gain', 4.5],
    ['--text-on-accent', '--loss', 4.5],
    ['--text-on-accent', '--warning', 4.5],
    ['--text-faint', '--bg-panel', 3],
    ['--text-faint', '--bg-app', 3],
  ])('%s on %s is at least %s:1', (fg, bg, min) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(min);
  });

  it.each([
    ['--gain-text', '--gain-tint'],
    ['--loss-text', '--loss-tint'],
    ['--gain-text', '--bg-selected'],
    ['--loss-text', '--bg-selected'],
    ['--gain-text', '--bg-hover'],
    ['--loss-text', '--bg-hover'],
    ['--warning-text', '--warning-tint'],
    ['--accent-text', '--accent-tint'],
    ['--accent-text', '--bg-selected'],
    ['--text-primary', '--bg-selected'],
    ['--text-primary', '--bg-hover'],
  ])('%s on %s over the panel is at least 4.5:1', (fg, tint) => {
    expect(contrast(color(fg), over(color(tint), panel))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the soft UI states visibly distinct from the panel', () => {
    expect(contrast(over(color('--bg-selected'), panel), panel)).toBeGreaterThan(1.05);
    expect(contrast(color('--border-strong'), panel)).toBeGreaterThan(contrast(color('--border'), panel));
    expect(contrast(color('--bg-panel'), app)).toBeGreaterThan(1);
  });
});

describe('theme fallback colors', () => {
  it('match the dark values in tokens.css so the chart never drifts from CSS', () => {
    const dark = themeTokens(source, 'dark');
    for (const [key, cssVar] of Object.entries(THEME_COLOR_VARS)) {
      const expected = parseColor(resolveVar(dark, cssVar));
      const actual = parseColor(FALLBACK_THEME_COLORS[key as keyof typeof FALLBACK_THEME_COLORS]);
      expect(actual, key).toEqual(expected);
    }
  });
});

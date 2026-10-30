import { describe, expect, it } from 'vitest';

/*
 * Adversarial checks of tokens.css / global.css against the written spec (not the implementation).
 * Vitest runs with `css: false`, so CSS is read from disk.
 */
interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string) => string[];
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;
const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
if (!dirname) throw new Error('import.meta.dirname unavailable');
const read = (rel: string) => fs.readFileSync(`${dirname}/${rel}`, 'utf8');

const tokensCss = read('tokens.css');
const globalCss = read('global.css');

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Tokens for a theme, honoring cascade order: bare :root first, theme selectors after. */
function themeTokens(theme: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {};
  const rules = [...strip(tokensCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sel: (m[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, '"').replace(/\s+/g, '')),
    body: m[2] ?? '',
  }));
  const apply = (body: string) => {
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const name = decl.slice(0, i).trim();
      if (name.startsWith('--')) out[name] = decl.slice(i + 1).trim();
    }
  };
  // Dark must also be what a document WITHOUT any data-theme attribute gets.
  for (const r of rules) if (r.sel.includes(':root')) apply(r.body);
  if (theme === 'light')
    for (const r of rules) if (r.sel.includes(':root[data-theme="light"]')) apply(r.body);
  return out;
}

function norm(value: string | undefined): string {
  if (value === undefined) return '<missing>';
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  const hex = /^#([0-9a-f]{3})$/.exec(v)?.[1];
  if (hex) return '#' + hex.replace(/./g, (c) => c + c);
  if (v === '#ffffff' || v === '#fff') return '#ffffff';
  // rgba(15,23,42,0.10) == rgba(15,23,42,0.1)
  return v.replace(/(\d*\.\d*?)0+\)/g, '$1)').replace(/\.\)/g, ')');
}

const SPEC: Record<string, [dark: string, light: string]> = {
  '--bg-app': ['#0F141B', '#F3F5F9'],
  '--bg-chrome': ['#131A23', '#E9EDF4'],
  '--bg-panel': ['#18202B', '#FDFDFE'],
  '--bg-raised': ['#1D2633', '#FFFFFF'],
  '--bg-input': ['#111821', '#FFFFFF'],
  '--bg-hover': ['rgba(232,238,246,0.05)', 'rgba(15,23,42,0.045)'],
  '--bg-selected': ['rgba(96,165,250,0.14)', 'rgba(37,99,235,0.10)'],
  '--border': ['#273242', '#DCE2EB'],
  '--border-strong': ['#34425A', '#C7D0DD'],
  '--text-primary': ['#E8EEF6', '#0F172A'],
  '--text-muted': ['#94A0B2', '#5A6478'],
  '--accent': ['#60A5FA', '#2563EB'],
  '--text-on-accent': ['#0A1424', '#F8FAFF'],
  '--gain': ['#34D399', '#047857'],
  '--loss': ['#F87171', '#DC2626'],
  '--gain-tint': ['rgba(52,211,153,0.14)', 'rgba(4,120,87,0.10)'],
  '--loss-tint': ['rgba(248,113,113,0.14)', 'rgba(220,38,38,0.10)'],
  '--warning': ['#FBBF24', '#B45309'],
  '--shadow-window': ['rgba(0,0,0,0.5)', 'rgba(15,23,42,0.12)'],
};

describe('tokens.css matches the specified palette exactly', () => {
  const dark = themeTokens('dark');
  const light = themeTokens('light');
  it.each(Object.entries(SPEC))('%s', (name, [d, l]) => {
    expect(norm(dark[name]), `dark ${name}`).toBe(norm(d));
    expect(norm(light[name]), `light ${name}`).toBe(norm(l));
  });

  it('declares :root and :root[data-theme="dark"] in the same block (dark default)', () => {
    expect(strip(tokensCss)).toMatch(/:root\s*,\s*:root\[data-theme=['"]dark['"]\]\s*\{/);
  });

  it('the light theme overrides every color token the dark theme defines (no dark leaks into light)', () => {
    const darkBlock =
      /:root\s*,\s*:root\[data-theme=['"]dark['"]\]\s*\{([^}]*)\}/.exec(strip(tokensCss))?.[1] ?? '';
    const lightBlock = /:root\[data-theme=['"]light['"]\]\s*\{([^}]*)\}/.exec(strip(tokensCss))?.[1] ?? '';
    const names = (block: string) =>
      [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).filter((n): n is string => !!n);
    const missing = names(darkBlock).filter((n) => !names(lightBlock).includes(n));
    expect(missing).toEqual([]);
  });

  it('focus ring is the accent at roughly 55% alpha in both themes', () => {
    for (const [t, accent] of [
      [dark, [96, 165, 250]],
      [light, [37, 99, 235]],
    ] as const) {
      const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(norm(t['--focus-ring']));
      expect(m, t['--focus-ring']).not.toBeNull();
      expect([Number(m![1]), Number(m![2]), Number(m![3])]).toEqual(accent);
      expect(Number(m![4])).toBeGreaterThanOrEqual(0.5);
      expect(Number(m![4])).toBeLessThanOrEqual(0.6);
    }
  });

  it('warning-tint matches the warning hue in each theme', () => {
    for (const t of [dark, light]) {
      const w = norm(t['--warning']).replace('#', '');
      const rgb = [0, 2, 4].map((i) => parseInt(w.slice(i, i + 2), 16));
      expect(norm(t['--warning-tint'])).toMatch(new RegExp(`^rgba\\(${rgb.join(',')},0?\\.\\d+\\)$`));
    }
  });

  it('defines --shadow-popover and --accent-hover in both themes', () => {
    for (const t of [dark, light]) {
      expect(t['--shadow-popover']).toBeTruthy();
      expect(t['--accent-hover']).toBeTruthy();
      expect(norm(t['--accent-hover'])).not.toBe(norm(t['--accent']));
    }
  });

  it('keeps the specified type, spacing, radius, height and motion scales', () => {
    const t = themeTokens('light');
    expect(t['--font-ui']?.replace(/'/g, '"')).toBe(
      '"Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
    );
    expect(t['--font-mono']?.replace(/'/g, '"')).toBe(
      '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    );
    expect(['xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((s) => t[`--fs-${s}`])).toEqual([
      '11px',
      '12px',
      '13px',
      '15px',
      '20px',
      '28px',
    ]);
    expect([1, 2, 3, 4, 5, 6].map((n) => t[`--sp-${n}`])).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '20px',
      '24px',
    ]);
    expect(['sm', 'md', 'lg'].map((s) => t[`--radius-${s}`])).toEqual(['4px', '6px', '8px']);
    expect(
      ['--h-control-sm', '--h-control', '--h-row', '--h-topbar', '--h-panel-header'].map((n) => t[n]),
    ).toEqual(['24px', '28px', '28px', '40px', '32px']);
    expect(t['--dur-fast']).toBe('120ms');
  });
});

describe('global.css contract', () => {
  const css = strip(globalCss);
  const ruleBody = (selectorRe: RegExp) => {
    const out: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (selectorRe.test((m[1] ?? '').trim())) out.push(m[2] ?? '');
    }
    return out.join(';');
  };

  it('uses border-box sizing everywhere', () => {
    expect(ruleBody(/\*,?/)).toMatch(/box-sizing:\s*border-box/);
  });

  it('gives html, body and #root 100% height', () => {
    const body = ruleBody(/html[\s\S]*body[\s\S]*#root/);
    expect(body).toMatch(/height:\s*100%/);
  });

  it('never scrolls the body and uses the 13px base', () => {
    const body = ruleBody(/^body$/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/font-size:\s*(13px|var\(--fs-md\))/);
    expect(body).toMatch(/font-family:\s*var\(--font-ui\)/);
  });

  it('defines .num with tabular figures', () => {
    expect(ruleBody(/^\.num$/)).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('defines a themed :focus-visible ring, ::selection and .visually-hidden', () => {
    expect(ruleBody(/^:focus-visible$/)).toMatch(/var\(--focus-ring\)/);
    expect(ruleBody(/^::selection$/)).toMatch(/background(-color)?:\s*var\(--/);
    const vh = ruleBody(/^\.visually-hidden$/);
    expect(vh).toMatch(/position:\s*absolute/);
    expect(vh).toMatch(/width:\s*1px/);
    expect(vh).toMatch(/overflow:\s*hidden/);
  });

  it('styles scrollbars thin and with theme tokens', () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/);
    expect(css).toMatch(/scrollbar-color:\s*var\(--/);
  });

  it('defines .flash-up / .flash-down with a ~600ms fade and disables them under reduced motion', () => {
    for (const cls of ['flash-up', 'flash-down']) {
      const body = ruleBody(new RegExp(`^\\.${cls}$`));
      expect(body, cls).toMatch(/animation|transition/);
      const dur = /(\d+)ms/.exec(body)?.[1] ?? /var\((--[\w-]+)\)/.exec(body)?.[1] ?? '';
      const ms = /^\d+$/.test(dur)
        ? Number(dur)
        : Number(/(\d+)ms/.exec(themeTokens('dark')[dur] ?? '')?.[1]);
      expect(ms, cls).toBeGreaterThanOrEqual(400);
      expect(ms, cls).toBeLessThanOrEqual(800);
    }
    const reduced =
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    expect(reduced).toMatch(/\.flash-up/);
    expect(reduced).toMatch(/\.flash-down/);
    expect(reduced).toMatch(/animation:\s*none|transition:\s*none/);
  });
});

describe('component styles use tokens for colors', () => {
  const uiDir = `${dirname}/../components/ui`;
  const files = fs.readdirSync(uiDir).filter((f) => /\.(css|tsx)$/.test(f) && !f.includes('.test.'));

  it.each(files)('%s has no hard-coded hex colors', (file) => {
    const src = strip(fs.readFileSync(`${uiDir}/${file}`, 'utf8'));
    expect(src.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) ?? []).toEqual([]);
  });

  it.each(files.filter((f) => f.endsWith('.css')))('%s has no rgb()/hsl() literal colors', (file) => {
    const src = strip(fs.readFileSync(`${uiDir}/${file}`, 'utf8'));
    expect(src.match(/\b(rgba?|hsla?)\(/g) ?? []).toEqual([]);
  });
});

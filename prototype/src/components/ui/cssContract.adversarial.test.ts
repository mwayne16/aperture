import { describe, expect, it } from 'vitest';

/*
 * Static checks of ui.css against the visual rules in the spec: compact 28px/24px controls,
 * a fixed panel header over a scrolling body, shadows only on popovers and dialogs, and motion
 * that respects prefers-reduced-motion. Vitest runs with `css: false`, so CSS is read from disk.
 */
interface Fs {
  readFileSync: (path: string, encoding: 'utf8') => string;
}
const fsModule = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsModule)) as Fs;
const dirname = (import.meta as ImportMeta & { dirname?: string }).dirname;
if (!dirname) throw new Error('import.meta.dirname unavailable');

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const uiCss = strip(fs.readFileSync(`${dirname}/ui.css`, 'utf8'));

interface Rule {
  selectors: string[];
  body: string;
}

/** Top-level rules only; at-rule blocks are cut out first. */
function topLevelRules(css: string): Rule[] {
  let flat = css;
  for (;;) {
    const next = flat.replace(/@[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    if (next === flat) break;
    flat = next;
  }
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
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

function prop(selector: string, property: string): string | undefined {
  let found: string | undefined;
  for (const r of topLevelRules(uiCss))
    if (r.selectors.includes(selector)) found = declarations(r.body)[property] ?? found;
  return found;
}

/** Selectors inside every `@media (prefers-reduced-motion: reduce)` block, with their bodies. */
function reducedMotionRules(): Rule[] {
  const out: Rule[] = [];
  for (const m of uiCss.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0 && i < uiCss.length) {
      if (uiCss[i] === '{') depth += 1;
      else if (uiCss[i] === '}') depth -= 1;
      i += 1;
    }
    out.push(...topLevelRules(uiCss.slice(start, i - 1)));
  }
  return out;
}

describe('ui.css visual contract (adversarial)', () => {
  it.each([
    ['.ui-btn', '--h-control'],
    ['.ui-btn--sm', '--h-control-sm'],
    ['.ui-iconbtn', '--h-control'],
    ['.ui-iconbtn--sm', '--h-control-sm'],
    ['.ui-input', '--h-control'],
    ['.ui-segmented', '--h-control'],
    ['.ui-segmented--sm', '--h-control-sm'],
    ['.ui-menu__item', '--h-control'],
    ['.ui-table td', '--h-row'],
    ['.ui-panel__header', '--h-panel-header'],
  ])('%s is sized by %s', (selector, token) => {
    expect(prop(selector, 'height')).toBe(`var(${token})`);
  });

  it('stacks toasts at the bottom right above the status bar, clear of page header actions', () => {
    expect(prop('.ui-toasts', 'position')).toBe('fixed');
    expect(prop('.ui-toasts', 'bottom')).toBe('calc(var(--h-control) + var(--sp-2))');
    expect(prop('.ui-toasts', 'right')).toBe('var(--sp-4)');
    expect(prop('.ui-toasts', 'top')).toBeUndefined();
    expect(prop('.ui-toasts', 'width')).toBe('340px');
    expect(prop('.ui-toasts', 'max-width')).toBe('calc(100vw - 32px)');
  });

  it('the panel header stays put and only the body scrolls', () => {
    expect(prop('.ui-panel__header', 'flex')).toBe('none');
    expect(prop('.ui-panel__body', 'overflow') ?? prop('.ui-panel__body', 'overflow-y')).toMatch(
      /auto|scroll/,
    );
    expect(prop('.ui-panel__body', 'min-height')).toBe('0');
  });

  it('casts drop shadows only from popovers, dialogs and toasts', () => {
    const allowed = /^\.ui-(tooltip|menu|dialog|toast)\b/;
    const offenders: string[] = [];
    for (const r of topLevelRules(uiCss)) {
      const shadow = declarations(r.body)['box-shadow'];
      if (!shadow || shadow === 'none') continue;
      // Insets and zero-blur rings (focus, borders) are not elevation.
      const layers = shadow.split(/,(?![^(]*\))/).map((l) => l.trim());
      const elevated = layers.some((layer) => {
        if (layer.startsWith('inset')) return false;
        const lengths = layer
          .replace(/var\([^)]*\)|rgba?\([^)]*\)/g, '')
          .trim()
          .split(/\s+/);
        const blur = lengths[2];
        return layer.startsWith('var(--shadow') || (blur !== undefined && parseFloat(blur) > 0);
      });
      if (elevated) offenders.push(...r.selectors.filter((s) => !allowed.test(s)));
    }
    expect(offenders).toEqual([]);
  });

  it('stops the skeleton shimmer and the status pulse under reduced motion', () => {
    const reduced = reducedMotionRules();
    const stops = (selector: string) =>
      reduced.some((r) => {
        if (!r.selectors.includes(selector)) return false;
        const d = declarations(r.body);
        return d.animation === 'none' || d.display === 'none' || d['animation-name'] === 'none';
      });
    expect(stops('.ui-skeleton::after')).toBe(true);
    expect(stops('.ui-status__dot.is-pulsing::after')).toBe(true);
  });

  it('every element with a transition loses it under reduced motion', () => {
    const reduced = reducedMotionRules();
    const calmed = new Set(
      reduced.filter((r) => declarations(r.body).transition === 'none').flatMap((r) => r.selectors),
    );
    const animated = topLevelRules(uiCss)
      .filter((r) => {
        const t = declarations(r.body).transition;
        return t !== undefined && t !== 'none';
      })
      .flatMap((r) => r.selectors);
    expect(animated.filter((s) => !calmed.has(s))).toEqual([]);
  });
});

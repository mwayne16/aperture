/**
 * Geometry for a sparkline: SVG path data for the price line and the area under it, scaled to fit
 * a box. Pure, so the drawing math is tested without rendering.
 */

export interface SparklineBox {
  width: number;
  height: number;
  /** Space kept clear inside every edge so the stroke isn't clipped. */
  inset: number;
}

export interface SparklineGeometry {
  line: string;
  /** The line closed down to the bottom edge, for a soft fill. */
  area: string;
  /** Vertical position of the baseline, or null when none was given. */
  baselineY: number | null;
}

/** Two decimals are plenty at sparkline size and keep the path data short. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Scales `values` into `box`, oldest on the left. Non-finite values are skipped. A `baseline` (such
 * as the previous close) is kept inside the vertical range so the line reads against it. Returns null
 * when fewer than two points remain, since one point can't draw a line.
 */
export function sparklineGeometry(
  values: readonly number[],
  box: SparklineBox,
  baseline: number | null = null,
): SparklineGeometry | null {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) return null;
  const hasBaseline = baseline !== null && Number.isFinite(baseline);

  let min = Math.min(...points);
  let max = Math.max(...points);
  if (hasBaseline) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }

  const inset = Math.max(0, box.inset);
  const innerWidth = Math.max(0, box.width - inset * 2);
  const innerHeight = Math.max(0, box.height - inset * 2);
  const span = max - min;
  // ** A flat series has no range to scale by, so it sits on the middle line.
  const yOf = (value: number) =>
    round(span === 0 ? box.height / 2 : inset + ((max - value) / span) * innerHeight);
  const xOf = (index: number) => round(inset + (index / (points.length - 1)) * innerWidth);

  const coordinates = points.map((value, index) => `${xOf(index)} ${yOf(value)}`);
  const line = `M${coordinates.join(' L')}`;
  const area = `${line} L${xOf(points.length - 1)} ${box.height} L${xOf(0)} ${box.height} Z`;
  return { line, area, baselineY: hasBaseline ? yOf(baseline) : null };
}

/** 1 when the series ends above where it started, -1 below, 0 flat or too short to tell. */
export function seriesDirection(values: readonly number[]): -1 | 0 | 1 {
  const points = values.filter((v) => Number.isFinite(v));
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || first === last) return 0;
  return last > first ? 1 : -1;
}

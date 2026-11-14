import { useEffect, useRef, useState, type RefObject } from 'react';
import { cx } from '../../components/ui/cx';
import { Skeleton } from '../../components/ui/Skeleton';
import { EMPTY_VALUE } from '../../lib/format';
import { sparklineCache } from './sparklineCache';
import { seriesDirection, sparklineGeometry } from './sparklinePath';
import './sparkline.css';

type SparklineView =
  { status: 'loading' } | { status: 'ready'; closes: readonly number[] } | { status: 'unavailable' };

interface Settled {
  symbol: string;
  view: SparklineView;
}

/**
 * One-day closes for `symbol` once `enabled`. A cached result shows at once; otherwise the view
 * loads until this symbol's own answer arrives. Errors and empty history read as unavailable.
 */
function useSparklineData(symbol: string, enabled: boolean): SparklineView {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    sparklineCache.load(symbol).then(
      (closes) => {
        if (active)
          setSettled({
            symbol,
            view: closes.length > 1 ? { status: 'ready', closes } : { status: 'unavailable' },
          });
      },
      () => {
        if (active) setSettled({ symbol, view: { status: 'unavailable' } });
      },
    );
    return () => {
      active = false;
    };
  }, [symbol, enabled]);

  if (settled?.symbol === symbol) return settled.view;
  const cached = sparklineCache.peek(symbol);
  return cached && cached.length > 1 ? { status: 'ready', closes: cached } : { status: 'loading' };
}

/**
 * True once the element has come near the viewport, so long tables only fetch the sparklines
 * someone scrolls to. Without IntersectionObserver (tests, old engines) everything counts as visible.
 */
function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, seen]);
  return seen;
}

interface SparklineProps {
  symbol: string;
  /** Drawing size in px. */
  width?: number;
  height?: number;
  /** Fill the container's width instead; the drawing stretches but the stroke keeps its thickness. */
  stretch?: boolean;
  /** Line color: 1 gain, -1 loss, 0 neutral. Defaults to the direction of the series itself. */
  direction?: -1 | 0 | 1;
  /** A reference price drawn as a dashed line, such as the previous close. */
  baseline?: number | null;
  className?: string;
}

/**
 * Small one-day price line for `symbol`. Decorative: the price and change sit next to it as text,
 * so it is hidden from assistive technology.
 */
export function Sparkline({
  symbol,
  width = 72,
  height = 24,
  stretch = false,
  direction,
  baseline = null,
  className,
}: SparklineProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeen(ref);
  const view = useSparklineData(symbol, seen);
  const geometry =
    view.status === 'ready' ? sparklineGeometry(view.closes, { width, height, inset: 2 }, baseline) : null;
  const trend = view.status === 'ready' ? (direction ?? seriesDirection(view.closes)) : 0;

  return (
    <span
      ref={ref}
      className={cx('sparkline', trend > 0 && 'is-gain', trend < 0 && 'is-loss', className)}
      style={{ width: stretch ? '100%' : width, height }}
      aria-hidden="true"
      data-status={view.status}
    >
      {view.status === 'loading' && <Skeleton width="100%" height={height} />}
      {view.status !== 'loading' && geometry === null && (
        <span className="sparkline__none">{EMPTY_VALUE}</span>
      )}
      {geometry !== null && (
        <svg
          className="sparkline__svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          focusable="false"
        >
          <path className="sparkline__area" d={geometry.area} />
          {geometry.baselineY !== null && (
            <line
              className="sparkline__baseline"
              x1={0}
              x2={width}
              y1={geometry.baselineY}
              y2={geometry.baselineY}
            />
          )}
          <path className="sparkline__line" d={geometry.line} />
        </svg>
      )}
    </span>
  );
}

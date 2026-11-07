import {
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  createChart,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type MouseEventParams,
  type TickMarkType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../components/ui/cx';
import { readThemeColors, useTheme } from '../../components/ui/theme';
import type { Bar, BarTimeframe } from '../../domain/types';
import { formatPrice } from '../../lib/format';
import {
  candleOptions,
  chartPalette,
  chartThemeOptions,
  chartableBars,
  findBarIndex,
  includePrice,
  placeTooltip,
  toCandles,
  toVolume,
  type ChartPalette,
} from './chartData';
import { announceBar, describeBar, formatBarTime, formatTickMark, isIntradayTimeframe } from './chartFormat';
import type { LiveLine } from './quoteView';
import './details.css';

interface PriceChartProps {
  bars: readonly Bar[];
  timeframe: BarTimeframe;
  /** The current quote, drawn as a dashed line apart from the historical bars. */
  live: LiveLine | null;
  /** Accessible description of what the chart shows. */
  summary: string;
}

/** Chart objects plus the latest values the chart's callbacks read. */
interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
  palette: ChartPalette;
  bars: readonly Bar[];
  livePrice: number | null;
  liveLine: IPriceLine | null;
}

/** The bar under the crosshair, with the point and chart size to place the tooltip. */
interface Inspection {
  time: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const TOOLTIP_SIZE = { width: 176, height: 136 };
const SHIFT_STEP = 10;

function fontOf(element: Element): string | undefined {
  return window.getComputedStyle(element).fontFamily || undefined;
}

/**
 * Candlesticks with a volume histogram (lightweight-charts). Colors follow the theme, the live price
 * updates in place without touching the bars, and the crosshair shows a tooltip for the bar under it.
 * The keyboard moves the crosshair too: arrows step one bar (Shift for ten), Home/End jump to the ends.
 */
export function PriceChart({ bars, timeframe, live, summary }: PriceChartProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const { resolved: theme } = useTheme();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const hintId = useId();
  const chartBars = useMemo(() => chartableBars(bars), [bars]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;
    const palette = chartPalette(readThemeColors());
    const chart = createChart(container, {
      autoSize: true,
      localization: { locale: 'en-US', priceFormatter: formatPrice },
      timeScale: { fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      ...candleOptions(palette),
      // ** The series' own last-value line would mark the last historical close; only the live line marks "now".
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const handles: ChartHandles = { chart, candles, volume, palette, bars: [], livePrice: null, liveLine: null };
    candles.applyOptions({ autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => includePrice(original(), handles.livePrice) });
    handlesRef.current = handles;

    const onCrosshairMove = (param: MouseEventParams) => {
      if (!param.point || typeof param.time !== 'number') {
        setInspection(null);
        return;
      }
      const { x, y } = param.point;
      setInspection({ time: param.time, x, y, width: container.clientWidth, height: container.clientHeight });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      chart.remove();
      handlesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handles = handlesRef.current;
    const container = canvasRef.current;
    if (!handles || !container) return;
    const palette = chartPalette(readThemeColors());
    handles.palette = palette;
    handles.chart.applyOptions(chartThemeOptions(palette, fontOf(container)));
    handles.candles.applyOptions(candleOptions(palette));
    handles.volume.setData(toVolume(handles.bars, palette));
  }, [theme]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.chart.applyOptions({
      localization: {
        timeFormatter: (time: Time) => (typeof time === 'number' ? formatBarTime(time, timeframe) : ''),
      },
      timeScale: {
        timeVisible: isIntradayTimeframe(timeframe),
        secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) => formatTickMark(time, type, timeframe),
      },
    });
  }, [timeframe]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.bars = chartBars;
    handles.candles.setData(toCandles(chartBars));
    handles.volume.setData(toVolume(chartBars, handles.palette));
    handles.chart.timeScale().fitContent();
  }, [chartBars]);

  const livePrice = live?.price ?? null;
  const liveLabel = live?.label ?? '';
  const liveMuted = live?.muted ?? false;
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    handles.livePrice = livePrice;
    if (livePrice === null) {
      if (handles.liveLine) handles.candles.removePriceLine(handles.liveLine);
      handles.liveLine = null;
      return;
    }
    const color = liveMuted ? handles.palette.stale : handles.palette.live;
    const options = {
      price: livePrice,
      title: liveLabel,
      color,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: color,
      axisLabelTextColor: handles.palette.liveText,
    };
    if (handles.liveLine) handles.liveLine.applyOptions(options);
    else handles.liveLine = handles.candles.createPriceLine(options);
  }, [livePrice, liveLabel, liveMuted, theme]);

  const inspectBar = (index: number) => {
    const handles = handlesRef.current;
    const container = canvasRef.current;
    const bar = chartBars[index];
    if (!handles || !container || !bar) return;
    const timeScale = handles.chart.timeScale();
    const visible = timeScale.getVisibleLogicalRange();
    if (visible && (index < visible.from || index > visible.to)) {
      const span = visible.to - visible.from;
      const from = index < visible.from ? index : index - span;
      timeScale.setVisibleLogicalRange({ from, to: from + span });
    }
    const time = bar.time as UTCTimestamp;
    handles.chart.setCrosshairPosition(bar.close, time, handles.candles);
    setInspection({
      time: bar.time,
      x: timeScale.timeToCoordinate(time) ?? 0,
      y: handles.candles.priceToCoordinate(bar.close) ?? 0,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    const details = describeBar(chartBars, index, timeframe);
    setAnnouncement(details ? announceBar(details) : '');
  };

  const clearInspection = () => {
    handlesRef.current?.chart.clearCrosshairPosition();
    setInspection(null);
    setAnnouncement('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = chartBars.length - 1;
    if (last < 0) return;
    const current = inspection ? findBarIndex(chartBars, inspection.time) : -1;
    const step = event.shiftKey ? SHIFT_STEP : 1;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = current < 0 ? last : Math.max(0, current - step);
        break;
      case 'ArrowRight':
        next = current < 0 ? last : Math.min(last, current + step);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      case 'Escape':
        if (!inspection) return;
        event.preventDefault();
        clearInspection();
        return;
      default:
        return;
    }
    event.preventDefault();
    inspectBar(next);
  };

  // ** An inspection whose time isn't in the current bars (the range just changed) shows nothing.
  const details = inspection ? describeBar(chartBars, findBarIndex(chartBars, inspection.time), timeframe) : null;
  const position = inspection && details ? placeTooltip(inspection, inspection, TOOLTIP_SIZE) : null;

  return (
    <div className="price-chart">
      <div
        ref={canvasRef}
        className="price-chart__canvas"
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={summary}
        aria-describedby={hintId}
        onKeyDown={handleKeyDown}
        onBlur={clearInspection}
      />
      <p id={hintId} className="visually-hidden">
        Use the arrow keys to inspect bars, Shift with an arrow to move ten bars, and Home or End for the first or
        last bar.
      </p>
      {details && position && (
        <div className="price-chart__tooltip" style={{ left: position.left, top: position.top }} aria-hidden="true">
          <p className="price-chart__tooltip-time">{details.time}</p>
          <dl className="price-chart__tooltip-values">
            {details.rows.map((row) => (
              <div key={row.label} className="price-chart__tooltip-row">
                <dt>{row.label}</dt>
                <dd className="num">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p
            className={cx(
              'price-chart__tooltip-change num',
              details.direction > 0 && 'is-gain',
              details.direction < 0 && 'is-loss',
            )}
          >
            {details.change}
          </p>
        </div>
      )}
      <div className="visually-hidden" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '../settings/settingsStore';
import { resetChartView, useChartRange, useChartStyle } from './chartView';

afterEach(() => {
  act(() => {
    useSettingsStore.getState().reset();
    resetChartView();
  });
});

describe('useChartRange and useChartStyle', () => {
  it('start from the settings', () => {
    act(() => {
      useSettingsStore.getState().update({ defaultChartRange: '6M', chartStyle: 'line' });
    });
    expect(renderHook(() => useChartRange()).result.current[0]).toBe('6M');
    expect(renderHook(() => useChartStyle()).result.current[0]).toBe('line');
  });

  it('share a pick between every chart, such as the quick view and the stock page', () => {
    const quickView = renderHook(() => useChartRange());
    const page = renderHook(() => useChartRange());
    act(() => {
      quickView.result.current[1]('1Y');
    });
    expect(page.result.current[0]).toBe('1Y');
  });

  it('give way to a changed setting, which an older pick never overrides again', () => {
    const style = renderHook(() => useChartStyle());
    act(() => {
      style.result.current[1]('line');
    });
    expect(style.result.current[0]).toBe('line');
    act(() => {
      useSettingsStore.getState().update({ chartStyle: 'line' });
    });
    act(() => {
      useSettingsStore.getState().update({ chartStyle: 'candles' });
    });
    expect(style.result.current[0]).toBe('candles');
  });

  it('keep a range pick when an unrelated setting changes', () => {
    const range = renderHook(() => useChartRange());
    act(() => {
      range.result.current[1]('5Y');
    });
    act(() => {
      useSettingsStore.getState().update({ chartStyle: 'line', triggerToasts: false });
    });
    expect(range.result.current[0]).toBe('5Y');
    act(() => {
      useSettingsStore.getState().update({ defaultChartRange: 'YTD' });
    });
    expect(range.result.current[0]).toBe('YTD');
  });
});

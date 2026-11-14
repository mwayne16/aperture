/*
 * QA for theme switching and the toast API as feature code uses them: a theme picker inside a
 * settings dialog, and toasts shown and dismissed by id or by their close button.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import { SegmentedControl } from './SegmentedControl';
import { readThemeColors, useTheme, type ThemePreference } from './theme';
import { dismissAllToasts, dismissToast, showToast } from './toastStore';
import { ToastViewport } from './ToastViewport';

afterEach(() => {
  act(() => {
    dismissAllToasts();
  });
});

function ThemePicker() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <>
      <SegmentedControl<ThemePreference>
        aria-label="Theme"
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'system', label: 'System' },
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
      />
      <output aria-label="Resolved theme">{resolved}</output>
    </>
  );
}

describe('theme switching (QA)', () => {
  it('a theme picker inside a dialog switches <html data-theme>, persists, and keeps the dialog and focus', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Dialog open onClose={onClose} title="Appearance">
          <ThemePicker />
        </Dialog>
      </StrictMode>,
    );
    const html = document.documentElement;
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();
    expect(html.dataset.theme).toBe('dark');

    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(html.dataset.theme).toBe('light');
    expect(screen.getByLabelText('Resolved theme')).toHaveTextContent('light');
    expect(localStorage.getItem('aperture.theme')).toBe('light');

    await user.keyboard('{ArrowLeft}');
    expect(html.dataset.theme).toBe('dark');
    expect(localStorage.getItem('aperture.theme')).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(localStorage.getItem('aperture.theme')).toBe('system');
    expect(html.dataset.theme).toBe('dark');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toHaveFocus();

    html.style.setProperty('--accent', '#2563eb');
    expect(readThemeColors().accent).toBe('#2563eb');
    html.style.removeProperty('--accent');
  });
});

describe('toast API (QA)', () => {
  it('dismissToast removes only its toast, and the close button works from the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <ToastViewport />
      </StrictMode>,
    );
    let first = '';
    act(() => {
      first = showToast({ tone: 'info', title: 'Feed reconnected', durationMs: 0 });
      showToast({ tone: 'error', title: 'Connection lost', description: 'Retrying in 5s.', durationMs: 0 });
      showToast({ tone: 'success', title: 'Alert created', durationMs: 0 });
    });
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);

    act(() => {
      dismissToast(first);
    });
    expect(within(region).queryByText('Feed reconnected')).not.toBeInTheDocument();
    expect(within(region).getByText('Retrying in 5s.')).toBeInTheDocument();

    await user.tab();
    expect(within(region).getAllByRole('button', { name: 'Dismiss notification' })[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(within(region).queryByText('Connection lost')).not.toBeInTheDocument();
    expect(within(region).getByText('Alert created')).toBeInTheDocument();
  });
});

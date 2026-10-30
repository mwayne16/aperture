import { Tabs as RadixTabs } from 'radix-ui';
import { type ReactNode } from 'react';
import { cx } from './cx';
import { useKeyboardFocusMove } from './useKeyboardFocusMove';
import './ui.css';

interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Small trailing content, usually a count. */
  badge?: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
}

/**
 * Tab strip with tablist semantics and automatic activation: Left/Right move and select (wrapping),
 * Home/End jump to the ends. The consumer renders the matching panel (role="tabpanel").
 */
export function Tabs<T extends string>({ tabs, value, onChange, 'aria-label': ariaLabel }: TabsProps<T>) {
  const { groupHandlers, movedByKeyboard } = useKeyboardFocusMove();

  const choose = (next: string) => {
    const tab = tabs.find((t) => t.value === next);
    if (tab && tab.value !== value) onChange(tab.value);
  };

  return (
    <RadixTabs.Root
      asChild
      value={value}
      // ** Radix's automatic mode reports a click twice: on press, then again when the press focuses
      // the tab. Manual mode reports the press once, and keyboard selection is handled below.
      activationMode="manual"
      onValueChange={choose}
    >
      <RadixTabs.List aria-label={ariaLabel} className="ui-tabs" {...groupHandlers}>
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.value}
            value={tab.value}
            // ** The consumer renders the panel, so there is no Radix panel for this to point at.
            aria-controls={undefined}
            className={cx('ui-tabs__tab', tab.value === value && 'is-selected')}
            // Arrow keys and Home/End only move focus in manual mode. Selection follows that focus.
            onFocus={() => {
              if (movedByKeyboard()) choose(tab.value);
            }}
          >
            <span className="ui-tabs__label">{tab.label}</span>
            {tab.badge != null && <span className="ui-tabs__badge">{tab.badge}</span>}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}

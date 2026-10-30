import { DropdownMenu } from 'radix-ui';
import { useState, type FocusEvent, type ReactNode } from 'react';
import { cx } from './cx';
import './ui.css';

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Spread these onto the trigger element (usually a Button or IconButton). */
interface MenuTriggerProps {
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'menu';
  ref: (node: HTMLElement | null) => void;
}

interface MenuProps {
  trigger: (props: MenuTriggerProps) => ReactNode;
  items: MenuItem[];
  /** Which trigger edge the menu lines up with. Default 'start'. */
  align?: 'start' | 'end';
}

// ** Radix focuses the menu itself when a pointer opens it and moves on to the first item only for
// keyboard opens. Moving focus that enters the menu from outside makes both opens behave the same.
function focusFirstItemOnEntry(e: FocusEvent<HTMLDivElement>) {
  const menu = e.currentTarget;
  const fromInside = e.relatedTarget instanceof Node && menu.contains(e.relatedTarget);
  if (e.target !== menu || fromInside) return;
  menu.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus({ preventScroll: true });
}

/**
 * Action menu. Opening moves focus to the first enabled item; Up/Down/Home/End move between
 * enabled items (wrapping), typing a letter jumps to the next matching item, Enter/Space select,
 * Esc and Tab close and return focus to the trigger, and a click outside closes.
 */
export function Menu({ trigger, items, align = 'start' }: MenuProps) {
  const [open, setOpen] = useState(false);
  // ** The trigger node lives in state (not a ref) so it can be handed to the render prop.
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  // ** Radix opens the menu on pointerdown and on Enter, Space or ArrowDown, so a click with
  // detail 0 came from neither. That is a screen reader or script activating the button.
  const toggleFromSyntheticClick = (event?: { detail: number }) => {
    if (event?.detail === 0) setOpen((wasOpen) => !wasOpen);
  };

  const select = (item: MenuItem) => {
    // ** Focus the trigger before running the action, so a dialog the action opens returns focus
    // to the trigger when it closes.
    triggerEl?.focus();
    item.onSelect();
  };

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger({
          onClick: toggleFromSyntheticClick,
          'aria-expanded': open,
          'aria-haspopup': 'menu',
          ref: setTriggerEl,
        })}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="ui-menu"
          side="bottom"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          loop
          onFocus={focusFirstItemOnEntry}
          onKeyDown={(e) => {
            if (e.key === 'Tab') setOpen(false);
          }}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              asChild
              disabled={item.disabled}
              textValue={item.label}
              onSelect={() => {
                select(item);
              }}
            >
              <button
                type="button"
                disabled={item.disabled}
                className={cx('ui-menu__item', item.danger === true && 'is-danger')}
              >
                {item.icon != null && (
                  <span className="ui-menu__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="ui-menu__label">{item.label}</span>
              </button>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

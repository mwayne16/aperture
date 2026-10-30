import { Tooltip as RadixTooltip, Slot } from 'radix-ui';
import {
  isValidElement,
  useState,
  type ComponentProps,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import './ui.css';

interface TooltipProps {
  content: ReactNode;
  /** A single element that accepts mouse/focus handlers (a button, usually). Its own ref is kept. */
  children: ReactElement;
  side?: 'top' | 'bottom';
  /** Hover delay before showing. Keyboard focus shows immediately. Default 400. */
  delayMs?: number;
}

function isFocusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

// ** Radix opens on any focus that a press did not cause, including focus a script moves back to
// the trigger after a mouse interaction. Only keyboard focus (:focus-visible) should show it.
function ignoreFocusUnlessVisible(e: FocusEvent<HTMLElement>) {
  if (!isFocusVisible(e.currentTarget)) e.preventDefault();
}

interface TriggerSlotProps extends ComponentProps<typeof Slot.Root> {
  describe: boolean;
}

/** Hands the trigger props to the child, minus the tooltip description when `describe` is off. */
function TriggerSlot({ describe, 'aria-describedby': describedBy, ...props }: TriggerSlotProps) {
  return <Slot.Root {...props} aria-describedby={describe ? describedBy : undefined} />;
}

/**
 * Hover shows the tooltip after `delayMs`; keyboard focus shows it at once. Leaving, blurring or
 * pressing the trigger hides it, and so does Escape. The content describes the trigger.
 */
export function Tooltip({ content, children, side = 'top', delayMs = 400 }: TooltipProps) {
  const [open, setOpen] = useState(false);
  if (!isValidElement(children)) return children;

  const hasContent = content != null && content !== '' && content !== false;
  const childLabel = (children.props as { 'aria-label'?: string })['aria-label'];
  // ** An icon button already uses the same text as its aria-label; describing it again is noise.
  const describes = !(typeof content === 'string' && childLabel === content);

  // The trigger tree stays the same while the content comes and goes, so the child keeps its
  // DOM node and focus.
  return (
    <RadixTooltip.Provider delayDuration={Math.max(0, delayMs)} skipDelayDuration={0} disableHoverableContent>
      <RadixTooltip.Root open={open && hasContent} onOpenChange={setOpen}>
        <RadixTooltip.Trigger asChild onFocus={ignoreFocusUnlessVisible}>
          <TriggerSlot describe={describes}>{children}</TriggerSlot>
        </RadixTooltip.Trigger>
        {hasContent && (
          <RadixTooltip.Portal>
            <RadixTooltip.Content className="ui-tooltip" side={side} sideOffset={6} collisionPadding={8}>
              {content}
            </RadixTooltip.Content>
          </RadixTooltip.Portal>
        )}
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

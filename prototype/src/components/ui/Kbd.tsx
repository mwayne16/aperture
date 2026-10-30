import type { ReactNode } from 'react';
import './ui.css';

interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return <kbd className="ui-kbd">{children}</kbd>;
}

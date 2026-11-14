/** Scrolls the element into view only as far as needed, inside its nearest scroll container. */
export function revealElement(element: Element | null): void {
  if (!element) return;
  // ** jsdom has no scrollIntoView, so test DOMs skip the scroll instead of throwing.
  const scroll = (element as Partial<Element>).scrollIntoView;
  if (typeof scroll === 'function') element.scrollIntoView({ block: 'nearest' });
}

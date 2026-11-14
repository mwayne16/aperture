/**
 * The updatedAt for a record that just changed: now, or 1 ms past the previous value when the clock
 * hasn't moved beyond it. updatedAt therefore strictly increases, and clients can use it to drop
 * copies that arrive out of order.
 */
export function nextUpdatedAt(now: Date, previous: Date): Date {
  return now.getTime() > previous.getTime() ? now : new Date(previous.getTime() + 1);
}

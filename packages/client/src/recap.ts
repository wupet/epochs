/**
 * The death recap: an HTML overlay that stays until you close it (the Close button, or Esc).
 */
import type { RecapMessage } from '@epochs/shared';

type RecapHit = RecapMessage['hits'][number];

/** One line per hit: `Slime — Touch — 3 damage — you were standing in its Touch telegraph (1-tick windup)`. */
export function recapLine(hit: RecapHit): string {
  const base = `${hit.attacker} — ${hit.attack} — ${hit.amount} damage`;
  if (hit.telegraph === null) return base;
  return `${base} — you were standing in its ${hit.telegraph.name} telegraph (${hit.telegraph.windupTicks}-tick windup)`;
}

/** The lines of a recap, oldest hit first (whatever order they arrive in). */
export function recapLines(recap: RecapMessage): string[] {
  return [...recap.hits].sort((a, b) => a.tick - b.tick).map(recapLine);
}

export interface RecapOverlay {
  /** Show the recap, or hide the overlay for null. Showing the same recap again changes nothing. */
  show(recap: RecapMessage | null): void;
}

export function createRecapOverlay(onClose: () => void): RecapOverlay {
  const root = document.createElement('div');
  root.className = 'recap-overlay';
  root.hidden = true;
  const card = document.createElement('div');
  card.className = 'recap-card';
  const title = document.createElement('h2');
  title.textContent = 'You died';
  const list = document.createElement('ul');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => {
    close.blur();
    onClose();
  });
  card.append(title, list, close);
  root.append(card);
  document.body.append(root);

  let shown: RecapMessage | null = null;
  return {
    show(recap) {
      if (recap === shown) return;
      shown = recap;
      root.hidden = recap === null;
      list.replaceChildren();
      if (recap === null) return;
      for (const line of recapLines(recap)) {
        const item = document.createElement('li');
        item.textContent = line;
        list.append(item);
      }
    },
  };
}

/**
 * Debug: the panel on the right for changing your character and the practice setup by hand. Plain
 * HTML, built once from the server's catalog and kept in step with your sheet. Every control sends
 * a `debug-…` message; the server decides what happens. It goes away when real progression arrives.
 */
import { ATTRIBUTES } from '@epochs/shared';
import type { Attribute, Attributes, DebugCatalog, DebugMessage, DebugMovePointMessage, SheetMessage } from '@epochs/shared';

// ---- Pure rules (tested without a browser) ----

/** The attribute new level points go to: the sheet's preset's main attribute (the first attribute with no preset, as on the server). */
export function mainAttributeOf(catalog: DebugCatalog, sheet: SheetMessage): Attribute {
  const preset = catalog.presets.find((p) => p.id === sheet.presetId);
  return preset?.mainAttribute ?? ATTRIBUTES[0];
}

/**
 * Which buttons an attribute row has. The main attribute has none: points move to and from it, never
 * between it and itself. "−" needs a level point on this attribute; "+" needs one on the main attribute.
 */
export interface AttributeButtons {
  readonly isMain: boolean;
  readonly canMinus: boolean;
  readonly canPlus: boolean;
}

export function attributeButtons(attribute: Attribute, main: Attribute, levelPoints: Attributes): AttributeButtons {
  const isMain = attribute === main;
  return {
    isMain,
    canMinus: !isMain && levelPoints[attribute] > 0,
    canPlus: !isMain && levelPoints[main] > 0,
  };
}

/** "−" moves a point from this attribute to the main one; "+" moves one from the main attribute to this one. */
export function movePointMessage(direction: 'minus' | 'plus', attribute: Attribute, main: Attribute): DebugMovePointMessage {
  return direction === 'minus'
    ? { type: 'debug-move-point', from: attribute, to: main }
    : { type: 'debug-move-point', from: main, to: attribute };
}

// ---- The panel ----

export interface DebugPanel {
  /** Build (once per catalog) and refresh the panel. Pass nulls before the welcome: the panel is hidden. */
  update(catalog: DebugCatalog | null, sheet: SheetMessage | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'debug-row');
  row.append(el('span', 'debug-label', label), control);
  return row;
}

function fillOptions(select: HTMLSelectElement, choices: readonly { value: string; label: string }[]): void {
  for (const choice of choices) {
    const option = el('option', undefined, choice.label);
    option.value = choice.value;
    select.append(option);
  }
}

function setValue(select: HTMLSelectElement, value: string): void {
  if (select.value !== value) select.value = value;
}

function numbered(count: number): { value: string; label: string }[] {
  return Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
}

interface Built {
  readonly catalog: DebugCatalog;
  readonly refresh: (sheet: SheetMessage) => void;
}

export function createDebugPanel(send: (message: DebugMessage) => void): DebugPanel {
  const root = el('div', 'debug-panel');
  root.hidden = true;
  const toggle = el('button', 'debug-toggle', 'Debug');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'true');
  const body = el('div', 'debug-body');
  root.append(toggle, body);
  document.body.append(root);
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.blur();
  });

  // After a control is used it lets go of the keyboard, because the game's shortcuts ignore focused form controls.
  function button(label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', undefined, label);
    b.type = 'button';
    b.addEventListener('click', () => {
      onClick();
      b.blur();
    });
    return b;
  }

  function select(onChange: (value: string) => void): HTMLSelectElement {
    const s = el('select');
    s.addEventListener('change', () => {
      onChange(s.value);
      s.blur();
    });
    return s;
  }

  function build(catalog: DebugCatalog): Built {
    body.replaceChildren();

    const preset = select((id) => {
      if (id !== '') send({ type: 'debug-preset', presetId: id });
    });
    // "(none)" is what a sheet with no preset shows; choosing it sends nothing.
    fillOptions(preset, [{ value: '', label: '(none)' }, ...catalog.presets.map((p) => ({ value: p.id, label: p.name }))]);

    const level = select((value) => send({ type: 'debug-level', level: Number(value) }));
    fillOptions(level, numbered(catalog.maxLevel));

    const weapon = select((value) => send({ type: 'debug-weapon', itemId: value === '' ? null : value }));
    fillOptions(weapon, [{ value: '', label: 'none' }, ...catalog.weapons.map((w) => ({ value: w.id, label: w.name }))]);

    const armor = select((value) => send({ type: 'debug-armor', itemId: value === '' ? null : value }));
    fillOptions(armor, [{ value: '', label: 'none' }, ...catalog.armors.map((a) => ({ value: a.id, label: a.name }))]);

    body.append(labelled('Preset', preset), labelled('Level', level), labelled('Weapon', weapon), labelled('Armor', armor));

    // Attributes. The preset's main attribute has no buttons; see `attributeButtons`.
    body.append(el('div', 'debug-heading', 'Attributes'));
    let main: Attribute = ATTRIBUTES[0];
    const attributeRows = new Map<Attribute, { value: HTMLElement; minus: HTMLButtonElement; plus: HTMLButtonElement }>();
    for (const attribute of ATTRIBUTES) {
      const row = el('div', 'debug-row');
      const value = el('span', 'debug-value');
      const minus = button('−', () => send(movePointMessage('minus', attribute, main)));
      const plus = button('+', () => send(movePointMessage('plus', attribute, main)));
      minus.title = 'Move a level point to the main attribute';
      plus.title = 'Move a level point here from the main attribute';
      row.append(el('span', 'debug-label', attribute[0]!.toUpperCase() + attribute.slice(1)), value, minus, plus);
      body.append(row);
      attributeRows.set(attribute, { value, minus, plus });
    }

    body.append(el('div', 'debug-heading', 'Class ranks'));
    const rankSelects = new Map<string, HTMLSelectElement>();
    for (const cls of catalog.classes) {
      const rank = select((value) => send({ type: 'debug-class-rank', classId: cls.id, rank: Number(value) }));
      fillOptions(rank, numbered(catalog.maxClassRank));
      body.append(labelled(cls.name, rank));
      rankSelects.set(cls.id, rank);
    }

    body.append(el('div', 'debug-heading', 'Practice'));
    const actions = el('div', 'debug-actions');
    actions.append(button('Heal', () => send({ type: 'debug-heal' })));
    for (const wave of catalog.waves) {
      actions.append(button(`Start ${wave.name}`, () => send({ type: 'debug-start-wave', waveId: wave.id })));
    }
    actions.append(button('Clear enemies', () => send({ type: 'debug-clear-enemies' })));
    body.append(actions);

    return {
      catalog,
      refresh(sheet) {
        setValue(preset, sheet.presetId ?? '');
        setValue(level, String(sheet.level));
        setValue(weapon, sheet.weaponId ?? '');
        setValue(armor, sheet.armorId ?? '');
        main = mainAttributeOf(catalog, sheet);
        for (const attribute of ATTRIBUTES) {
          const row = attributeRows.get(attribute)!;
          const buttons = attributeButtons(attribute, main, sheet.levelPoints);
          const points = sheet.levelPoints[attribute];
          const total = sheet.attributes[attribute];
          row.value.textContent = points > 0 ? `${total} (${points} from levels)` : String(total);
          row.minus.hidden = buttons.isMain;
          row.plus.hidden = buttons.isMain;
          row.minus.disabled = !buttons.canMinus;
          row.plus.disabled = !buttons.canPlus;
        }
        for (const [classId, rank] of rankSelects) setValue(rank, String(sheet.classRanks[classId] ?? 1));
      },
    };
  }

  let built: Built | null = null;
  let lastSheet: SheetMessage | null = null;

  return {
    update(catalog, sheet) {
      if (catalog === null || sheet === null) {
        root.hidden = true;
        built = null;
        lastSheet = null;
        return;
      }
      root.hidden = false;
      if (built === null || built.catalog !== catalog) {
        built = build(catalog);
        lastSheet = null;
      }
      if (sheet !== lastSheet) {
        built.refresh(sheet);
        lastSheet = sheet;
      }
    },
  };
}

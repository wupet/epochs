/**
 * Pixi drawing for combat: the campfire, telegraphs, enemies, health bars and floating numbers.
 * Everything is drawn into the per-frame `Graphics` the renderer clears; numbers use a pool of `Text`
 * objects so no text is created per frame.
 */
import { Container, Text } from 'pixi.js';
import type { Graphics } from 'pixi.js';
import type { ClientWorld } from './client-world';
import {
  COLOR_CAMPFIRE,
  COLOR_DEALT,
  COLOR_HEALTH,
  COLOR_HEALTH_LOST,
  COLOR_TAKEN,
  HEALTH_BAR_PX,
  TELEGRAPH_FILL_ALPHA,
  TELEGRAPH_OUTLINE_PX,
  enemyColor,
  floatRise,
  healthFraction,
  showsHealthBar,
  telegraphColor,
} from './combat-style';
import { FLOAT_MS } from './floating-numbers';

/** Where and how big the map is on screen, and when "now" is, for one frame. */
export interface DrawFrame {
  readonly g: Graphics;
  readonly world: ClientWorld;
  readonly originX: number;
  readonly originY: number;
  readonly tileSize: number;
  readonly nowMs: number;
}

/** The fraction of a tile a square is inset on each side. */
export const SQUARE_INSET = 0.15;

/** A health bar over a square whose top-left corner is at (left, top) on screen and whose side is `size`. */
export function drawHealthBar(g: Graphics, left: number, top: number, size: number, health: number, maxHealth: number): void {
  const y = top - HEALTH_BAR_PX - 1;
  g.rect(left, y, size, HEALTH_BAR_PX).fill(COLOR_HEALTH_LOST);
  const filled = size * healthFraction(health, maxHealth);
  if (filled > 0) g.rect(left, y, filled, HEALTH_BAR_PX).fill(COLOR_HEALTH);
}

/** The campfire, where players respawn: an orange disc in the middle of its tile. */
export function drawCampfire(frame: DrawFrame): void {
  const { g, world, originX, originY, tileSize } = frame;
  const fire = world.campfire;
  if (fire === null) return;
  g.circle(originX + (fire.x + 0.5) * tileSize, originY + (fire.y + 0.5) * tileSize, tileSize * 0.3).fill(COLOR_CAMPFIRE);
}

/** Every active telegraph: its tiles filled and outlined in the damage kind's colour. */
export function drawTelegraphs(frame: DrawFrame): void {
  const { g, world, originX, originY, tileSize } = frame;
  for (const telegraph of world.telegraphs) {
    const color = telegraphColor(telegraph.kind);
    for (const tile of telegraph.tiles) {
      g.rect(originX + tile.x * tileSize, originY + tile.y * tileSize, tileSize, tileSize).fill({
        color,
        alpha: TELEGRAPH_FILL_ALPHA,
      });
      g.rect(
        originX + tile.x * tileSize + TELEGRAPH_OUTLINE_PX / 2,
        originY + tile.y * tileSize + TELEGRAPH_OUTLINE_PX / 2,
        tileSize - TELEGRAPH_OUTLINE_PX,
        tileSize - TELEGRAPH_OUTLINE_PX,
      ).stroke({ width: TELEGRAPH_OUTLINE_PX, color });
    }
  }
}

/** Every enemy as a square coloured by family, sliding as it moves, with its health bar. */
export function drawEnemies(frame: DrawFrame): void {
  const { g, world, originX, originY, tileSize, nowMs } = frame;
  const inset = tileSize * SQUARE_INSET;
  const size = tileSize - 2 * inset;
  for (const id of world.enemyIds()) {
    const pos = world.enemyPositionOf(id, nowMs);
    const info = world.enemyInfo(id);
    if (pos === undefined || info === undefined) continue;
    const left = originX + pos.x * tileSize + inset;
    const top = originY + pos.y * tileSize + inset;
    g.rect(left, top, size, size).fill(enemyColor(info.family));
    if (showsHealthBar(true, info.health, info.maxHealth)) drawHealthBar(g, left, top, size, info.health, info.maxHealth);
  }
}

/** A pool of `Text` objects: `begin`, then `show` for each label, then `end` hides the unused ones. */
export class TextPool {
  private readonly items: { text: Text; color: number; size: number }[] = [];
  private used = 0;

  constructor(private readonly container: Container) {}

  begin(): void {
    this.used = 0;
  }

  /** Show a label with its bottom centre at (x, y). Text is only re-laid-out when its content, size or colour changes. */
  show(content: string, x: number, y: number, color: number, size: number, alpha: number): void {
    let item = this.items[this.used];
    if (item === undefined) {
      const text = new Text({
        text: '',
        style: { fontFamily: 'system-ui, sans-serif', fontWeight: 'bold', fontSize: size, fill: color, stroke: { color: 0x000000, width: 3 } },
      });
      text.anchor.set(0.5, 1);
      this.container.addChild(text);
      item = { text, color, size };
      this.items.push(item);
    }
    this.used++;
    if (item.text.text !== content) item.text.text = content;
    if (item.size !== size) {
      item.text.style.fontSize = size;
      item.size = size;
    }
    if (item.color !== color) {
      item.text.style.fill = color;
      item.color = color;
    }
    item.text.position.set(x, y);
    item.text.alpha = alpha;
    item.text.visible = true;
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i]!.text.visible = false;
  }
}

/** The damage numbers you dealt (white) and took (red), each rising from its target and fading. */
export function drawFloatingNumbers(frame: DrawFrame, pool: TextPool): void {
  const { world, originX, originY, tileSize, nowMs } = frame;
  const size = Math.max(12, Math.round(tileSize * 0.5));
  pool.begin();
  for (const n of world.floatingNumbers(nowMs)) {
    pool.show(
      String(n.amount),
      originX + (n.x + 0.5) * tileSize,
      originY + (n.y - floatRise(n.age)) * tileSize,
      n.mine === 'dealt' ? COLOR_DEALT : COLOR_TAKEN,
      size,
      1 - n.age / FLOAT_MS,
    );
  }
  pool.end();
}

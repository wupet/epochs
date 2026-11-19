/**
 * All PixiJS drawing and pointer/keyboard input. The grid is drawn once per layout; everything that
 * moves (path preview, click marker, squares, tick pulse) is redrawn every frame.
 */
import { Application, Graphics } from 'pixi.js';
import { findRoute, inBounds } from '@epochs/shared';
import type { Grid, Tile } from '@epochs/shared';
import type { ClientWorld } from './client-world';
import { computeLayout, fitTileSize, tileAtScreen } from './layout';
import type { Layout } from './layout';
import { pulseEnabledFromSearch, pulseLevel } from './pulse';

const SQUARE_INSET = 0.15;

const COLOR_BACKGROUND = 0x111111;
const COLOR_OPEN = 0x2b2b2b;
const COLOR_BLOCKED = 0x0a0a0a;
const COLOR_LINE = 0xffffff;
const COLOR_YOU = 0xf2c14e;
const COLOR_OTHER = 0x4ea3f2;
const COLOR_PREVIEW = 0xffffff;
const COLOR_MARKER = 0xf2c14e;

const HINT = 'click to move · P toggles tick pulse';

export interface Renderer {
  /** Call when a tick has been applied, so the pulse restarts. */
  noteTick(nowMs: number): void;
  setConnected(connected: boolean): void;
}

export interface RendererOptions {
  readonly world: ClientWorld;
  /** Called when the player left-clicks an in-bounds tile. */
  readonly onMoveIntent: (tile: Tile) => void;
}

/** The layout for now: zoom fits the whole map and the map is centred. (Zoom keys and camera follow come later.) */
function currentLayout(grid: Grid): Layout {
  const tileSize = fitTileSize(window.innerWidth, window.innerHeight, grid.width, grid.height);
  const focus = { x: Math.floor(grid.width / 2), y: Math.floor(grid.height / 2) };
  return computeLayout(window.innerWidth, window.innerHeight, grid.width, grid.height, tileSize, focus);
}

function sameLayout(a: Layout, b: Layout): boolean {
  return a.tileSize === b.tileSize && a.originX === b.originX && a.originY === b.originY;
}

export async function startRenderer(options: RendererOptions): Promise<Renderer> {
  const { world, onMoveIntent } = options;

  const app = new Application();
  await app.init({ resizeTo: window, background: COLOR_BACKGROUND, antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const gridLayer = new Graphics();
  const dynamicLayer = new Graphics();
  app.stage.addChild(gridLayer, dynamicLayer);

  const statusLine = document.createElement('div');
  statusLine.id = 'status';
  document.body.appendChild(statusLine);

  let connected = false;
  let lastTickAt = -Infinity;
  let pulseEnabled = pulseEnabledFromSearch(location.search);
  let hovered: Tile | null = null;
  let marker: Tile | null = null;

  // The static grid is redrawn only when the grid or the layout changes.
  let drawnGrid: Grid | null = null;
  let drawnLayout: Layout | null = null;

  // The path preview is recomputed only when the hovered tile or your server tile changes.
  let previewKey = '';
  let previewPath: readonly Tile[] = [];
  let previewDestination: Tile | null = null;

  function drawGrid(grid: Grid, layout: Layout): void {
    const { tileSize, originX: offsetX, originY: offsetY } = layout;
    gridLayer.clear();
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const blocked = grid.blocked[y * grid.width + x]!;
        gridLayer
          .rect(offsetX + x * tileSize, offsetY + y * tileSize, tileSize, tileSize)
          .fill(blocked ? COLOR_BLOCKED : COLOR_OPEN);
      }
    }
    const right = offsetX + grid.width * tileSize;
    const bottom = offsetY + grid.height * tileSize;
    for (let x = 0; x <= grid.width; x++) {
      gridLayer.moveTo(offsetX + x * tileSize, offsetY).lineTo(offsetX + x * tileSize, bottom);
    }
    for (let y = 0; y <= grid.height; y++) {
      gridLayer.moveTo(offsetX, offsetY + y * tileSize).lineTo(right, offsetY + y * tileSize);
    }
    gridLayer.stroke({ width: 1, color: COLOR_LINE, alpha: 0.07 });
  }

  function tileAt(clientX: number, clientY: number, grid: Grid): Tile | null {
    const rect = app.canvas.getBoundingClientRect();
    const tile = tileAtScreen(currentLayout(grid), clientX - rect.left, clientY - rect.top);
    return inBounds(grid, tile) ? tile : null;
  }

  app.canvas.addEventListener('pointermove', (event: PointerEvent) => {
    const grid = world.grid;
    hovered = grid === null ? null : tileAt(event.clientX, event.clientY, grid);
  });
  app.canvas.addEventListener('pointerleave', () => {
    hovered = null;
  });
  app.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || !connected) return;
    const grid = world.grid;
    if (grid === null) return;
    const tile = tileAt(event.clientX, event.clientY, grid);
    if (tile === null) return;
    onMoveIntent(tile);
    const mine = world.you === null ? undefined : world.tileOf(world.you);
    marker = mine === undefined ? null : findRoute(grid, mine, tile).destination;
  });
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'p') pulseEnabled = !pulseEnabled;
  });

  function frame(): void {
    const grid = world.grid;
    const now = performance.now();

    dynamicLayer.clear();
    // Before the welcome there is no grid: draw nothing.
    if (grid === null) {
      gridLayer.clear();
      drawnGrid = null;
      drawnLayout = null;
    } else {
      const layout = currentLayout(grid);
      if (grid !== drawnGrid || drawnLayout === null || !sameLayout(layout, drawnLayout)) {
        drawGrid(grid, layout);
        drawnGrid = grid;
        drawnLayout = layout;
      }
      const { tileSize, originX: offsetX, originY: offsetY } = layout;
      const you = world.you;
      const mine = you === null ? undefined : world.tileOf(you);

      // Hover path preview, from your latest server tile.
      if (hovered !== null && mine !== undefined) {
        const key = `${hovered.x},${hovered.y}|${mine.x},${mine.y}`;
        if (key !== previewKey) {
          const route = findRoute(grid, mine, hovered);
          previewKey = key;
          previewPath = route.path;
          previewDestination = route.destination;
        }
        for (const tile of previewPath) {
          dynamicLayer
            .rect(offsetX + tile.x * tileSize, offsetY + tile.y * tileSize, tileSize, tileSize)
            .fill({ color: COLOR_PREVIEW, alpha: 0.18 });
        }
        if (previewDestination !== null) {
          dynamicLayer
            .rect(
              offsetX + previewDestination.x * tileSize + 1,
              offsetY + previewDestination.y * tileSize + 1,
              tileSize - 2,
              tileSize - 2,
            )
            .stroke({ width: 2, color: COLOR_PREVIEW, alpha: 0.8 });
        }
      }

      // Click marker: a small cross until you arrive.
      if (marker !== null && mine !== undefined && mine.x === marker.x && mine.y === marker.y) marker = null;
      if (marker !== null) {
        const cx = offsetX + (marker.x + 0.5) * tileSize;
        const cy = offsetY + (marker.y + 0.5) * tileSize;
        const arm = tileSize * 0.25;
        dynamicLayer
          .moveTo(cx - arm, cy - arm)
          .lineTo(cx + arm, cy + arm)
          .moveTo(cx + arm, cy - arm)
          .lineTo(cx - arm, cy + arm)
          .stroke({ width: 2, color: COLOR_MARKER, alpha: 0.9 });
      }

      // Squares, with you drawn last so you are on top.
      const inset = tileSize * SQUARE_INSET;
      const size = tileSize - 2 * inset;
      const drawSquare = (id: number, color: number): void => {
        const pos = world.positionOf(id, now);
        if (pos === undefined) return;
        dynamicLayer
          .rect(offsetX + pos.x * tileSize + inset, offsetY + pos.y * tileSize + inset, size, size)
          .fill(color);
      };
      for (const id of world.ids()) if (id !== you) drawSquare(id, COLOR_OTHER);
      if (you !== null) drawSquare(you, COLOR_YOU);

      // Tick pulse: a faint white wash over the whole grid.
      if (pulseEnabled) {
        const level = pulseLevel(now - lastTickAt);
        if (level > 0) {
          dynamicLayer
            .rect(offsetX, offsetY, grid.width * tileSize, grid.height * tileSize)
            .fill({ color: 0xffffff, alpha: level });
        }
      }
    }

    const text = `${connected ? 'connected' : 'disconnected'} · tick ${Math.max(world.tick, 0)} · ${HINT}`;
    if (statusLine.textContent !== text) statusLine.textContent = text;
  }

  app.ticker.add(frame);

  return {
    noteTick(nowMs: number): void {
      lastTickAt = nowMs;
    },
    setConnected(value: boolean): void {
      connected = value;
    },
  };
}

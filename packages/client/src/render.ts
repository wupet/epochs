/**
 * All PixiJS drawing and pointer/keyboard input. The grid is drawn once per tile size and view size;
 * everything that moves (path preview, click marker, squares, tick pulse) is redrawn every frame.
 * The camera follows your square when the map is bigger than the view.
 */
import { Application, Container, Graphics } from 'pixi.js';
import { findRoute, inBounds, routeIntoReach, withBlockers } from '@epochs/shared';
import type { DebugMovementMode, EnemyId, Grid, Tile } from '@epochs/shared';
import type { ClientWorld } from './client-world';
import {
  TextPool,
  drawCampfire,
  drawEnemies,
  drawFloatingNumbers,
  drawHealthBar,
  drawTelegraphs,
} from './combat-draw';
import type { DrawFrame } from './combat-draw';
import { SQUARE_INSET, showsHealthBar } from './combat-style';
import { clickAction, isFormControl } from './keys';
import { computeLayout, fitTileSize, tileAtScreen, zoomIn, zoomOut } from './layout';
import type { Layout } from './layout';
import { pulseEnabledFromSearch, pulseLevel } from './pulse';

const COLOR_BACKGROUND = 0x111111;
const COLOR_OPEN = 0x2b2b2b;
const COLOR_BLOCKED = 0x0a0a0a;
const COLOR_LINE = 0xffffff;
const COLOR_YOU = 0xf2c14e;
const COLOR_OTHER = 0x4ea3f2;
const COLOR_PREVIEW = 0xffffff;
const COLOR_MARKER = 0xf2c14e;

const HINT = '(debug: 1 walk · 2 run · 3 horse) · A attack-move · +/− zoom · P pulse';
const ATTACK_MOVE_STATUS = 'attack-move: click a tile';

// Debug controls: running and riding get real rules later.
const DEBUG_MODE_KEYS: Readonly<Record<string, DebugMovementMode>> = { '1': 'walk', '2': 'run', '3': 'horse' };

export interface Renderer {
  /** Call when a tick has been applied, so the pulse restarts. */
  noteTick(nowMs: number): void;
  setConnected(connected: boolean): void;
}

export interface RendererOptions {
  readonly world: ClientWorld;
  /** Called when the player left-clicks an in-bounds tile. */
  readonly onMoveIntent: (tile: Tile) => void;
  /** Called when the player left-clicks an enemy. */
  readonly onAttackIntent: (enemyId: EnemyId) => void;
  /** Called when the player, with attack-move armed (A), left-clicks a tile with no enemy. */
  readonly onAttackMoveIntent: (tile: Tile) => void;
  /** Called when Esc is pressed while the death recap is open. */
  readonly onDismissRecap: () => void;
  /** Called when the player presses a debug speed key. */
  readonly onModeIntent: (mode: DebugMovementMode) => void;
}

export async function startRenderer(options: RendererOptions): Promise<Renderer> {
  const { world, onMoveIntent, onModeIntent, onAttackIntent, onAttackMoveIntent, onDismissRecap } = options;

  const app = new Application();
  await app.init({ resizeTo: window, background: COLOR_BACKGROUND, antialias: true });
  document.getElementById('app')!.appendChild(app.canvas);

  const gridLayer = new Graphics();
  const dynamicLayer = new Graphics();
  const numberLayer = new Container();
  app.stage.addChild(gridLayer, dynamicLayer, numberLayer);
  const numbers = new TextPool(numberLayer);

  const statusLine = document.createElement('div');
  statusLine.id = 'status';
  document.body.appendChild(statusLine);

  let connected = false;
  let lastTickAt = -Infinity;
  let pulseEnabled = pulseEnabledFromSearch(location.search);
  let hovered: Tile | null = null;
  /** Where the last click went: a destination tile, or the enemy attacked. Cleared on arrival or when the enemy is gone. */
  let marker: { kind: 'tile'; tile: Tile } | { kind: 'enemy'; id: EnemyId } | null = null;
  /** Attack-move armed with A: the next left click attack-moves (or attacks the enemy it lands on). */
  let attackMoveArmed = false;
  let requestedMode: DebugMovementMode = 'walk';

  // Zoom: null means "fit" (the whole map in view, recomputed on resize); a number is a chosen tile size.
  let zoomTileSize: number | null = null;

  // The pointer's last screen position (null once it has left). The hovered tile is recomputed every
  // frame from this, because a following camera scrolls the map under a still mouse.
  let pointer: { x: number; y: number } | null = null;

  // The static grid is redrawn only when the grid, the tile size or the view size changes. When only
  // the camera moves, the grid layer is repositioned instead.
  let drawnGrid: Grid | null = null;
  let drawnTileSize = 0;
  let drawnViewW = 0;
  let drawnViewH = 0;

  // The path preview is recomputed only when the hovered tile, your server tile, the tick or your weapon changes.
  let previewKey = '';
  let previewPath: readonly Tile[] = [];
  let previewDestination: Tile | null = null;

  /** The reach (tiles) of your equipped weapon, or undefined with none (or before the sheet and catalog arrive). */
  function weaponRange(): number | undefined {
    const weaponId = world.sheet?.weaponId;
    if (weaponId === null || weaponId === undefined) return undefined;
    return world.catalog?.weapons.find((w) => w.id === weaponId)?.rangeTiles;
  }

  /** The layout now. The camera follows your drawn square, or the grid centre before you have one. */
  function currentLayout(grid: Grid, nowMs: number): Layout {
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const tileSize = zoomTileSize ?? fitTileSize(viewW, viewH, grid.width, grid.height);
    const you = world.you;
    const yours = you === null ? undefined : world.positionOf(you, nowMs);
    const focus = yours ?? { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
    const layout = computeLayout(viewW, viewH, grid.width, grid.height, tileSize, focus);
    // Whole pixels, so the lines stay crisp while the camera follows.
    return { tileSize, originX: Math.round(layout.originX), originY: Math.round(layout.originY) };
  }

  /** Draw the grid with its top-left corner at (0, 0); the layer's position puts it on screen. */
  function drawGrid(grid: Grid, tileSize: number): void {
    gridLayer.clear();
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const blocked = grid.blocked[y * grid.width + x]!;
        gridLayer.rect(x * tileSize, y * tileSize, tileSize, tileSize).fill(blocked ? COLOR_BLOCKED : COLOR_OPEN);
      }
    }
    const right = grid.width * tileSize;
    const bottom = grid.height * tileSize;
    for (let x = 0; x <= grid.width; x++) {
      gridLayer.moveTo(x * tileSize, 0).lineTo(x * tileSize, bottom);
    }
    for (let y = 0; y <= grid.height; y++) {
      gridLayer.moveTo(0, y * tileSize).lineTo(right, y * tileSize);
    }
    gridLayer.stroke({ width: 1, color: COLOR_LINE, alpha: 0.07 });
  }

  // The layout of the last drawn frame. Clicks use it, so a click lands on the tile the player saw
  // outlined, not on a neighbour the following camera has since scrolled to.
  let lastLayout: Layout | null = null;

  /** The in-bounds tile under a screen position, using the layout the player last saw. */
  function tileAt(clientX: number, clientY: number, grid: Grid): Tile | null {
    const rect = app.canvas.getBoundingClientRect();
    const layout = lastLayout ?? currentLayout(grid, performance.now());
    const tile = tileAtScreen(layout, clientX - rect.left, clientY - rect.top);
    return inBounds(grid, tile) ? tile : null;
  }

  app.canvas.addEventListener('pointermove', (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
  });
  app.canvas.addEventListener('pointerleave', () => {
    pointer = null;
  });
  // A right click cancels attack-move; the browser's menu has no use over the map.
  app.canvas.addEventListener('contextmenu', (event: Event) => event.preventDefault());
  app.canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button === 2) {
      attackMoveArmed = false;
      return;
    }
    if (event.button !== 0 || !connected) return;
    const grid = world.grid;
    if (grid === null) return;
    const tile = tileAt(event.clientX, event.clientY, grid);
    if (tile === null) return;
    // The body as it is drawn (mid-slide) wins; otherwise the enemy on the tile by its server tile.
    const layout = lastLayout ?? currentLayout(grid, performance.now());
    const rect = app.canvas.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left - layout.originX) / layout.tileSize,
      y: (event.clientY - rect.top - layout.originY) / layout.tileSize,
    };
    const action = clickAction(attackMoveArmed, world.enemyUnderPoint(point, performance.now()));
    attackMoveArmed = false;
    if (action.kind === 'attack') {
      onAttackIntent(action.enemyId);
      marker = { kind: 'enemy', id: action.enemyId };
      return;
    }
    if (action.kind === 'attack-move') onAttackMoveIntent(tile);
    else onMoveIntent(tile);
    const mine = world.you === null ? undefined : world.tileOf(world.you);
    const destination =
      mine === undefined ? null : findRoute(withBlockers(grid, world.blockerTiles()), mine, tile).destination;
    marker = destination === null ? null : { kind: 'tile', tile: destination };
  });
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    // Typing in or operating the debug panel never moves the game.
    if (isFormControl(event.target)) return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === 'Escape') {
      if (world.recap !== null) onDismissRecap();
      else attackMoveArmed = false;
      return;
    }
    if (key.toLowerCase() === 'a') {
      // Only once admitted, like the speed keys.
      if (world.you !== null && connected) attackMoveArmed = true;
      return;
    }
    if (key.toLowerCase() === 'p') {
      pulseEnabled = !pulseEnabled;
      return;
    }
    // Debug controls: running and riding get real rules later.
    const mode = DEBUG_MODE_KEYS[key];
    if (mode !== undefined) {
      // Only once admitted: before the welcome (or while queued, or disconnected) there is no character to change.
      if (world.you === null || !connected) return;
      requestedMode = mode;
      onModeIntent(mode);
      return;
    }
    // Any zoom key leaves "fit". Zooming needs a grid to know the current size.
    const grid = world.grid;
    if (grid === null) return;
    const current = zoomTileSize ?? fitTileSize(window.innerWidth, window.innerHeight, grid.width, grid.height);
    if (key === '+' || key === '=') zoomTileSize = zoomIn(current);
    else if (key === '-' || key === '_') zoomTileSize = zoomOut(current);
    else if (key === '0') zoomTileSize = null; // back to fit
  });

  function frame(): void {
    const grid = world.grid;
    const now = performance.now();

    dynamicLayer.clear();
    // Before the welcome there is no grid: draw nothing.
    if (grid === null) {
      gridLayer.clear();
      drawnGrid = null;
      lastLayout = null;
    } else {
      const layout = currentLayout(grid, now);
      lastLayout = layout;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      if (grid !== drawnGrid || layout.tileSize !== drawnTileSize || viewW !== drawnViewW || viewH !== drawnViewH) {
        drawGrid(grid, layout.tileSize);
        drawnGrid = grid;
        drawnTileSize = layout.tileSize;
        drawnViewW = viewW;
        drawnViewH = viewH;
      }
      gridLayer.position.set(layout.originX, layout.originY);
      const { tileSize, originX: offsetX, originY: offsetY } = layout;

      // The hovered tile, recomputed from the pointer every frame because the camera may have moved.
      if (pointer === null) {
        hovered = null;
      } else {
        const rect = app.canvas.getBoundingClientRect();
        const tile = tileAtScreen(layout, pointer.x - rect.left, pointer.y - rect.top);
        hovered = inBounds(grid, tile) ? tile : null;
      }

      const you = world.you;
      const mine = you === null ? undefined : world.tileOf(you);

      // Hover path preview, from your latest server tile, routed around enemies as the server does. Over an
      // enemy it is the route into reach of your weapon (none without one), and the enemy is outlined.
      let hoveredEnemy: EnemyId | undefined;
      if (pointer !== null && hovered !== null) {
        const rect = app.canvas.getBoundingClientRect();
        hoveredEnemy = world.enemyUnderPoint(
          { x: (pointer.x - rect.left - offsetX) / tileSize, y: (pointer.y - rect.top - offsetY) / tileSize },
          now,
        );
      }
      // Over an enemy, the target is its latest server tile (the body may still be sliding there).
      const hoverTarget = hoveredEnemy === undefined ? hovered : (world.enemyTileOf(hoveredEnemy) ?? hovered);
      if (hovered !== null && hoverTarget !== null && mine !== undefined) {
        const range = weaponRange();
        const key = `${hoveredEnemy === undefined ? '' : 'e'}${hoverTarget.x},${hoverTarget.y}|${mine.x},${mine.y}|${world.tick}|${range ?? ''}`;
        if (key !== previewKey) {
          const blockers = withBlockers(grid, world.blockerTiles());
          previewKey = key;
          if (hoveredEnemy !== undefined) {
            previewPath = range === undefined ? [] : routeIntoReach(blockers, grid, mine, hoverTarget, range);
            previewDestination = hoverTarget;
          } else {
            const route = findRoute(blockers, mine, hoverTarget);
            previewPath = route.path;
            previewDestination = route.destination;
          }
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

      // The campfire, telegraphs and enemies come before the squares, so players are drawn on top of them.
      const frameInfo: DrawFrame = { g: dynamicLayer, world, originX: offsetX, originY: offsetY, tileSize, nowMs: now };
      drawCampfire(frameInfo);
      drawTelegraphs(frameInfo);
      drawEnemies(frameInfo);

      // Click marker: a small cross on a tile until you arrive, or an outline on the enemy until it is gone.
      if (marker !== null && marker.kind === 'tile' && mine !== undefined && mine.x === marker.tile.x && mine.y === marker.tile.y) {
        marker = null;
      }
      if (marker !== null && marker.kind === 'enemy' && world.enemyTileOf(marker.id) === undefined) marker = null;
      if (marker !== null && marker.kind === 'tile') {
        const cx = offsetX + (marker.tile.x + 0.5) * tileSize;
        const cy = offsetY + (marker.tile.y + 0.5) * tileSize;
        const arm = tileSize * 0.25;
        dynamicLayer
          .moveTo(cx - arm, cy - arm)
          .lineTo(cx + arm, cy + arm)
          .moveTo(cx + arm, cy - arm)
          .lineTo(cx - arm, cy + arm)
          .stroke({ width: 2, color: COLOR_MARKER, alpha: 0.9 });
      } else if (marker !== null) {
        const at = world.enemyTileOf(marker.id);
        if (at !== undefined) {
          dynamicLayer
            .rect(offsetX + at.x * tileSize + 1, offsetY + at.y * tileSize + 1, tileSize - 2, tileSize - 2)
            .stroke({ width: 2, color: COLOR_MARKER, alpha: 0.9 });
        }
      }

      // Squares, with you drawn last so you are on top.
      const inset = tileSize * SQUARE_INSET;
      const size = tileSize - 2 * inset;
      const drawSquare = (id: number, color: number): void => {
        const pos = world.positionOf(id, now);
        if (pos === undefined) return;
        const left = offsetX + pos.x * tileSize + inset;
        const top = offsetY + pos.y * tileSize + inset;
        const health = world.healthOf(id);
        const maxHealth = world.maxHealthOf(id);
        // A player who is down (health 0) is drawn faded until they stand up.
        dynamicLayer.rect(left, top, size, size).fill({ color, alpha: health === 0 ? 0.35 : 1 });
        if (health !== undefined && maxHealth !== undefined && showsHealthBar(false, health, maxHealth)) {
          drawHealthBar(dynamicLayer, left, top, size, health, maxHealth);
        }
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

      // Damage numbers float above everything, in the pooled text layer.
      drawFloatingNumbers(frameInfo, numbers);
    }

    // Before the welcome there is no grid: show no numbers.
    if (grid === null) {
      numbers.begin();
      numbers.end();
    }

    let text: string;
    if (world.serverFull) text = 'The server and its queue are full. Try again later.';
    else if (!connected) text = 'disconnected';
    else if (grid === null && world.queuePosition !== null) text = `In queue: position ${world.queuePosition}`;
    else if (attackMoveArmed) text = `connected · tick ${Math.max(world.tick, 0)} · ${ATTACK_MOVE_STATUS}`;
    else text = `connected · tick ${Math.max(world.tick, 0)} · ${requestedMode} ${HINT}`;
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

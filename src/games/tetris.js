/*!
 * Falling blocks game logic inspired by javascript-tetris by Jake Gordon
 * https://github.com/jakesgordon/javascript-tetris (commit e5c0c42)
 * Copyright (c) 2011-2016 Jake Gordon and contributors — MIT License
 * See THIRD-PARTY-NOTICES.md
 *
 * This is a clean reimplementation, not a direct copy.
 *
 * Dichoptic falling-blocks:
 *   falling piece / ghost / next  -> amblyopic eye only
 *   locked rows 0..17             -> fellow eye only
 *   locked rows 18..19            -> both eyes (fusion lock)
 *   frame + HUD text              -> both eyes
 */

import { AnaglyphRenderer } from '../anaglyph.js';
import { getSettings, addSession } from '../store.js';

/* ---------- Constants ---------- */

const COLS = 10;
const ROWS = 20;
const FUSION_ROWS = 2; // bottom rows both eyes can see
const LOCK_DELAY_MS = 350;
const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 6;

const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

const BASE_MATRICES = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0]
  ],
  O: [
    [1, 1],
    [1, 1]
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0]
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0]
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0]
  ]
};

function rotateMatrixCW(m) {
  const n = m.length;
  const out = [];
  for (let y = 0; y < n; y++) {
    const row = new Array(n);
    for (let x = 0; x < n; x++) row[x] = m[n - 1 - x][y];
    out.push(row);
  }
  return out;
}

function cellsOf(matrix) {
  const cells = [];
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (matrix[y][x]) cells.push([x, y]);
    }
  }
  return cells;
}

/** ROT[type][0..3] = array of [x,y] cells. Precomputed once. */
const ROT = {};
for (const t of TYPES) {
  const states = [];
  let m = BASE_MATRICES[t];
  for (let i = 0; i < 4; i++) {
    states.push(cellsOf(m));
    m = rotateMatrixCW(m);
  }
  ROT[t] = states;
}

const SPAWN_X = {
  I: 3,
  J: 3,
  L: 3,
  O: 4,
  S: 3,
  T: 3,
  Z: 3
};

// Simple kick table: try no offset, then sideways nudge, then a small lift.
const KICKS = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1]
];

function speedForLevel(level) {
  return Math.max(70, Math.round(900 * Math.pow(0.85, Math.max(0, level - 1))));
}

const LINE_SCORES = [0, 100, 300, 500, 800];

/* ---------- Small helpers ---------- */

const pad2 = (n) => String(n).padStart(2, '0');

function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${pad2(s)}`;
}

function fmtDuration(sec) {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/* ---------- Screen ---------- */

export function mountTetris(root, ctx) {
  let cfg = getSettings();

  const screen = document.createElement('div');
  screen.className = 'screen screen--game';

  /* ----- Title + HUD ----- */
  const hud = document.createElement('div');
  hud.className = 'game-hud';

  // Visible page heading (previously this screen had no h1 at all).
  const gameTitle = document.createElement('h1');
  gameTitle.className = 'game-title';
  gameTitle.textContent = 'Falling blocks';

  const hudScore = document.createElement('span');
  hudScore.innerHTML = 'Score <strong>0</strong>';
  const hudLevel = document.createElement('span');
  hudLevel.innerHTML = 'Level <strong>1</strong>';
  const hudLines = document.createElement('span');
  hudLines.innerHTML = 'Lines <strong>0</strong>';
  const hudTime = document.createElement('span');
  hudTime.innerHTML = 'Time <strong>--:--</strong>';

  const hudActions = document.createElement('div');
  hudActions.className = 'hud-actions';

  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.textContent = 'Pause';
  const quitBtn = document.createElement('button');
  quitBtn.type = 'button';
  quitBtn.textContent = 'Stop';
  hudActions.append(pauseBtn, quitBtn);

  hud.append(hudScore, hudLevel, hudLines, hudTime, hudActions);

  // Polite, throttled screen-reader status line. Announcing every frame would
  // flood assistive tech, so updates are coalesced (see announceStatus()).
  const liveRegion = document.createElement('div');
  liveRegion.className = 'visually-hidden';
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.textContent = 'Falling blocks ready.';

  /* ----- Stage / canvas ----- */
  const stage = document.createElement('div');
  stage.className = 'game-stage';

  const wrap = document.createElement('div');
  wrap.className = 'game-canvas-wrap';

  const canvas = document.createElement('canvas');
  // The canvas is an output surface (input goes through the HUD buttons, the
  // touch pad and the global key handler), so it is exposed as an image with
  // a name — plus real fallback text for non-canvas user agents.
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label',
    'Falling-blocks playfield. The falling piece appears in your weaker eye, the stack in your stronger eye, and the bottom two rows plus the border in both eyes.');
  canvas.textContent =
    'Your browser cannot display the falling-blocks playfield. Current score, level, lines and time are shown above, ' +
    'and every change is announced in this text area.';
  wrap.appendChild(canvas);
  stage.appendChild(wrap);

  /* ----- Touch pad ----- */
  const pad = document.createElement('div');
  pad.className = 'touchpad';

  const touchSupported =
    'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0 || (navigator.msMaxTouchPoints || 0) > 0;

  const padButtons = [
    { key: 'left', label: '\u25C0', aria: 'Move left' },
    { key: 'rotate', label: '\u27F3', aria: 'Rotate' },
    { key: 'right', label: '\u25B6', aria: 'Move right' },
    { key: 'soft', label: '\u25BC', aria: 'Soft drop' },
    { key: 'hard', label: '\u23E9', aria: 'Hard drop' }
  ];

  if (touchSupported) pad.classList.add('is-visible');

  screen.append(gameTitle, hud, liveRegion, stage, pad);

  /* ----- Overlay host (covers the whole stage so menus are roomy) ----- */
  const overlayHost = stage;

  let overlayEl = null;

  function clearOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  function showOverlay(build) {
    clearOverlay();
    const el = document.createElement('div');
    el.className = 'overlay-actions';
    el.style.overflowY = 'auto';
    build(el);
    overlayHost.appendChild(el);
    overlayEl = el;
    return el;
  }

  /* ---------- Game state ---------- */

  const board = new Uint8Array(COLS * ROWS);

  let bag = [];
  let piece = null;
  let nextType = 'T';

  let score = 0;
  let level = 1;
  let lines = 0;

  let gravityAcc = 0;
  let lockDelay = 0;

  // ready | playing | paused | over
  // 'ready' is a plain start overlay: no alignment or offset-line declaration
  // is required (that gate was unsupported and has been removed).
  let phase = 'ready';
  let sessionMs = Math.max(5, cfg.sessionLengthMin) * 60 * 1000;
  let remainingMs = sessionMs;
  let saved = false;

  let rafId = 0;
  let lastTime = 0;
  let acc = 0;

  let disposeLayoutObserver = null;

  /* ---------- Renderer ---------- */

  const renderer = new AnaglyphRenderer(canvas);
  renderer.configure(cfg);

  /* ---------- Layout ---------- */

  let layout = { cell: 24, stripH: 34, pad: 2, w: 260, h: 520, fs: 12 };

  function computeLayout() {
    const rect = stage.getBoundingClientRect();
    const availW = Math.max(120, rect.width || window.innerWidth || 320);
    const availH = Math.max(200, rect.height || window.innerHeight * 0.7 || 400);

    const padPx = 2;
    const stripH = Math.round(Math.min(58, Math.max(28, availH * 0.085)));

    const byW = (availW - padPx * 4) / COLS;
    const byH = (availH - stripH - padPx * 4) / ROWS;
    const cell = Math.max(6, Math.floor(Math.min(byW, byH)));

    const w = cell * COLS + padPx * 2;
    const h = stripH + cell * ROWS + padPx * 2;
    const fs = Math.round(Math.min(15, Math.max(9, cell * 0.5)));

    return { cell, stripH, pad: padPx, w, h, fs };
  }

  function applyLayout() {
    layout = computeLayout();
    wrap.style.width = layout.w + 'px';
    wrap.style.height = layout.h + 'px';
    canvas.style.width = layout.w + 'px';
    canvas.style.height = layout.h + 'px';

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(layout.w * dpr));
    const bh = Math.max(1, Math.round(layout.h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const c = canvas.getContext('2d', { alpha: false });
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- Board helpers ---------- */

  function collides(px, py, rot, type) {
    const cells = ROT[type || piece.type][rot];
    for (let i = 0; i < cells.length; i++) {
      const x = px + cells[i][0];
      const y = py + cells[i][1];
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y * COLS + x]) return true;
    }
    return false;
  }

  /* ---------- Piece spawning ---------- */

  function refillBag() {
    bag = TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = bag[i];
      bag[i] = bag[j];
      bag[j] = t;
    }
  }

  function takeFromBag() {
    if (bag.length === 0) refillBag();
    return bag.pop();
  }

  function spawn(type) {
    const t = type || nextType;
    if (!type) nextType = takeFromBag();

    piece = { type: t, x: SPAWN_X[t], y: 0, rot: 0 };
    gravityAcc = 0;
    lockDelay = 0;

    if (collides(piece.x, piece.y, piece.rot, piece.type)) {
      piece = null;
      return false;
    }
    return true;
  }

  /* ---------- Actions ---------- */

  function move(dx) {
    if (!piece || phase !== 'playing') return false;
    if (!collides(piece.x + dx, piece.y, piece.rot, piece.type)) {
      piece.x += dx;
      lockDelay = 0;
      return true;
    }
    return false;
  }

  function rotate(dir) {
    if (!piece || phase !== 'playing') return false;
    if (piece.type === 'O') return false;
    const nextRot = (piece.rot + (dir < 0 ? 3 : 1)) % 4;
    for (let i = 0; i < KICKS.length; i++) {
      const nx = piece.x + KICKS[i][0];
      const ny = piece.y + KICKS[i][1];
      if (!collides(nx, ny, nextRot, piece.type)) {
        piece.x = nx;
        piece.y = ny;
        piece.rot = nextRot;
        lockDelay = 0;
        return true;
      }
    }
    return false;
  }

  function softDrop() {
    if (!piece || phase !== 'playing') return false;
    if (!collides(piece.x, piece.y + 1, piece.rot, piece.type)) {
      piece.y += 1;
      score += 1;
      lockDelay = 0;
      gravityAcc = 0;
      draw();
      updateHud();
      return true;
    }
    // Resting on the stack: nudge the lock timer along.
    lockDelay = LOCK_DELAY_MS;
    return false;
  }

  function ghostY() {
    if (!piece) return 0;
    let y = piece.y;
    while (!collides(piece.x, y + 1, piece.rot, piece.type)) y++;
    return y;
  }

  function hardDrop() {
    if (!piece || phase !== 'playing') return;
    const gy = ghostY();
    score += Math.max(0, (gy - piece.y) * 2);
    piece.y = gy;
    lockPiece();
  }

  /* ---------- Locking / line clear ---------- */

  function lockPiece() {
    if (!piece) return;
    const cells = ROT[piece.type][piece.rot];
    for (let i = 0; i < cells.length; i++) {
      const x = piece.x + cells[i][0];
      const y = piece.y + cells[i][1];
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) board[y * COLS + x] = 1;
    }
    piece = null;
    clearLines();

    if (!spawn()) {
      gameOver('topped out');
      return;
    }
    draw();
    updateHud();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      let full = true;
      for (let x = 0; x < COLS; x++) {
        if (!board[y * COLS + x]) {
          full = false;
          break;
        }
      }
      if (!full) continue;

      cleared++;
      // Shift everything above down by one.
      for (let yy = y; yy > 0; yy--) {
        for (let x = 0; x < COLS; x++) {
          board[yy * COLS + x] = board[(yy - 1) * COLS + x];
        }
      }
      for (let x = 0; x < COLS; x++) board[x] = 0;
      y++; // re-check this row index after the shift
    }

    if (cleared > 0) {
      lines += cleared;
      score += (LINE_SCORES[cleared] || 0) * level;
      level = 1 + Math.floor(lines / 10);
    }
  }

  /* ---------- Drawing ---------- */

  function drawBlock(r, x, y, cell, eye) {
    const inset = cell >= 12 ? 1 : 0;
    const w = cell - inset * 2;
    const h = cell - inset * 2;
    if (w <= 0 || h <= 0) return;
    r.drawRect(x + inset, y + inset, w, h, eye);
  }

  function drawOutline(r, x, y, cell, eye) {
    const t = Math.max(1, Math.round(cell * 0.14));
    r.drawFrame(x + 1, y + 1, cell - 2, cell - 2, t, eye);
  }

  function drawWell() {
    const r = renderer;
    const { cell, pad: p, stripH } = layout;
    const ox = p;
    const oy = p + stripH;
    const wellW = cell * COLS;
    const wellH = cell * ROWS;

    // Well frame (both eyes) — gives the fused binocular anchor.
    r.drawFrame(ox - 2, oy - 2, wellW + 4, wellH + 4, 2, 'both');

    // Fusion-lock band marker at the bottom two rows: short ticks on both edges.
    const bandTop = oy + (ROWS - FUSION_ROWS) * cell;
    r.drawRect(ox - 4, bandTop, 2, FUSION_ROWS * cell, 'both');
    r.drawRect(ox + wellW + 2, bandTop, 2, FUSION_ROWS * cell, 'both');

    // Locked blocks.
    for (let y = 0; y < ROWS; y++) {
      const eye = y >= ROWS - FUSION_ROWS ? 'both' : 'fellow';
      const rowBase = y * COLS;
      for (let x = 0; x < COLS; x++) {
        if (!board[rowBase + x]) continue;
        drawBlock(r, ox + x * cell, oy + y * cell, cell, eye);
      }
    }

    if (!piece) return;

    // Ghost piece.
    const gy = ghostY();
    if (gy !== piece.y) {
      const gcells = ROT[piece.type][piece.rot];
      for (let i = 0; i < gcells.length; i++) {
        const x = piece.x + gcells[i][0];
        const y = gy + gcells[i][1];
        if (y < 0) continue;
        drawOutline(r, ox + x * cell, oy + y * cell, cell, 'amblyopic');
      }
    }

    // Active piece — amblyopic eye only.
    const cells = ROT[piece.type][piece.rot];
    for (let i = 0; i < cells.length; i++) {
      const x = piece.x + cells[i][0];
      const y = piece.y + cells[i][1];
      if (y < 0) continue;
      drawBlock(r, ox + x * cell, oy + y * cell, cell, 'amblyopic');
    }
  }

  function drawNextPreview(r, x, y, size) {
    const cells = ROT[nextType][0];
    let minX = 9;
    let maxX = -1;
    let minY = 9;
    let maxY = -1;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i][0] < minX) minX = cells[i][0];
      if (cells[i][0] > maxX) maxX = cells[i][0];
      if (cells[i][1] < minY) minY = cells[i][1];
      if (cells[i][1] > maxY) maxY = cells[i][1];
    }
    const gw = maxX - minX + 1;
    const gh = maxY - minY + 1;
    const ox = x - (gw * size) / 2;
    const oy = y - (gh * size) / 2;
    for (let i = 0; i < cells.length; i++) {
      drawBlock(
        r,
        ox + (cells[i][0] - minX) * size,
        oy + (cells[i][1] - minY) * size,
        size,
        'amblyopic'
      );
    }
  }

  function drawHudStrip(r) {
    const { pad: p, stripH, fs, w } = layout;
    const font = '600 ' + fs + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
    const baseY = p + stripH * 0.5 + fs * 0.36;

    // Next-piece preview box on the right.
    const size = Math.max(5, Math.round(layout.cell * 0.52));
    const previewBoxW = size * 4.2;
    const previewCx = w - p - previewBoxW / 2;

    r.drawText('SCORE ' + score, p + 3, baseY, font, 'both', 'left');
    r.drawText('LV ' + level, Math.round(w * 0.5), baseY, font, 'both', 'left');
    r.drawText('LINES ' + lines, Math.round(w - p - previewBoxW - 4), baseY, font, 'both', 'right');

    drawNextPreview(r, previewCx, p + stripH * 0.5, size);
  }

  function draw() {
    const r = renderer;
    r.clear();
    drawHudStrip(r);
    drawWell();
    r.composite();
  }

  /* ---------- HUD ---------- */

  // HUD DOM writes are throttled: only touch the DOM when a value changes.
  const hudCache = { score: -1, level: -1, lines: -1, time: '', phase: '', minutes: -1 };

  /* ---------- Screen-reader announcements ---------- */
  // Politeness + throttling: at most one status announcement every few seconds,
  // always coalesced to the latest state. Never one per frame.

  const ANNOUNCE_MIN_INTERVAL_MS = 4000;
  let announceTimer = 0;
  let announceBuilder = null;
  let announceLastAt = 0;

  function clearAnnounceTimer() {
    if (announceTimer) {
      clearTimeout(announceTimer);
      announceTimer = 0;
    }
  }

  function flushAnnounce() {
    clearAnnounceTimer();
    if (!announceBuilder) return;
    const build = announceBuilder;
    announceBuilder = null;
    announceLastAt = Date.now();
    liveRegion.textContent = build();
  }

  /** Immediate announcement (phase changes only). */
  function announceNow(text) {
    announceBuilder = null;
    clearAnnounceTimer();
    announceLastAt = Date.now();
    liveRegion.textContent = text;
  }

  /** Throttled announcement of the current status, read at flush time. */
  function announceStatus() {
    announceBuilder = statusLine;
    if (announceTimer) return; // a flush is already pending; it will read the latest
    const wait = Math.max(0, ANNOUNCE_MIN_INTERVAL_MS - (Date.now() - announceLastAt));
    announceTimer = setTimeout(flushAnnounce, wait);
  }

  function spokenMinutes(ms) {
    const mins = Math.max(0, Math.ceil(ms / 60000));
    return mins + (mins === 1 ? ' minute' : ' minutes');
  }

  function statusLine() {
    const parts = ['Score ' + score, 'level ' + level, 'lines ' + lines];
    if (phase === 'playing' || phase === 'paused') {
      parts.push(spokenMinutes(remainingMs) + ' remaining');
    }
    return parts.join(', ') + '.';
  }

  function updateHud(force) {
    const prevScore = hudCache.score;
    const prevLevel = hudCache.level;
    const prevLines = hudCache.lines;

    if (force || hudCache.score !== score) {
      hudCache.score = score;
      hudScore.innerHTML = 'Score <strong>' + score + '</strong>';
    }
    if (force || hudCache.level !== level) {
      hudCache.level = level;
      hudLevel.innerHTML = 'Level <strong>' + level + '</strong>';
    }
    if (force || hudCache.lines !== lines) {
      hudCache.lines = lines;
      hudLines.innerHTML = 'Lines <strong>' + lines + '</strong>';
    }

    let label;
    if (phase === 'ready') label = '--:--';
    else if (phase === 'over') label = fmtClock(sessionMs - remainingMs);
    else label = fmtClock(remainingMs);

    if (force || hudCache.time !== label || hudCache.phase !== phase) {
      hudCache.time = label;
      hudCache.phase = phase;
      hudTime.innerHTML = 'Time <strong>' + label + '</strong>';
    }

    // Announce score/level/lines changes and each whole-minute countdown step,
    // coalesced by announceStatus() so assistive tech is never flooded.
    const minutes =
      phase === 'playing' || phase === 'paused' ? Math.ceil(remainingMs / 60000) : -1;
    if (
      prevScore !== hudCache.score ||
      prevLevel !== hudCache.level ||
      prevLines !== hudCache.lines ||
      minutes !== hudCache.minutes
    ) {
      hudCache.minutes = minutes;
      announceStatus();
    }
  }

  /* ---------- Game loop ---------- */

  function tick(dt) {
    if (!piece) return;

    gravityAcc += dt;
    const interval = speedForLevel(level);

    while (gravityAcc >= interval) {
      gravityAcc -= interval;
      if (!collides(piece.x, piece.y + 1, piece.rot, piece.type)) {
        piece.y += 1;
        lockDelay = 0;
      } else {
        break;
      }
    }

    if (collides(piece.x, piece.y + 1, piece.rot, piece.type)) {
      lockDelay += dt;
      if (lockDelay >= LOCK_DELAY_MS) lockPiece();
    } else {
      lockDelay = 0;
    }
  }

  function frame(now) {
    if (phase !== 'playing') {
      rafId = 0;
      lastTime = now;
      return;
    }
    rafId = requestAnimationFrame(frame);

    const raw = lastTime ? now - lastTime : STEP_MS;
    lastTime = now;
    const dt = Math.min(raw, 120);

    remainingMs -= dt;
    if (remainingMs <= 0) {
      remainingMs = 0;
      updateHud();
      endSession('timer');
      return;
    }

    acc += dt;
    let steps = 0;
    while (acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      tick(STEP_MS);
      acc -= STEP_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;

    if (phase !== 'playing') return; // tick() may have ended the game

    draw();
    updateHud();
  }

  /* ---------- Session lifecycle ---------- */

  // Deliberate stop vs. timer expiry vs. topping out must read differently.
  const END_HEADINGS = {
    timer: 'Session complete',
    stopped: 'Session stopped',
    'topped out': 'Game over',
    'game over': 'Game over'
  };

  function endHeading(reason) {
    return END_HEADINGS[reason] || 'Session ended';
  }

  function resetGame() {
    board.fill(0);
    bag = [];
    nextType = takeFromBag();
    piece = null;
    score = 0;
    level = 1;
    lines = 0;
    gravityAcc = 0;
    lockDelay = 0;
    acc = 0;
    remainingMs = sessionMs;
    saved = false;
    spawn();
    updateHud();
    draw();
  }

  function startSession() {
    cfg = getSettings();
    sessionMs = Math.max(5, cfg.sessionLengthMin) * 60 * 1000;
    renderer.configure(cfg);
    resetGame();
    phase = 'playing';
    lastTime = 0;
    pauseBtn.textContent = 'Pause';
    clearOverlay();
    updateHud(true);
    announceNow('Session started. ' + spokenMinutes(remainingMs) + ' on the clock. ' + statusLine());
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function saveSession(reason) {
    if (saved) return;
    const durationSec = Math.max(0, Math.round((sessionMs - remainingMs) / 1000));
    if (durationSec < 1) return;
    saved = true;
    addSession({
      game: 'tetris',
      durationSec,
      score,
      level,
      lines,
      fellowContrast: cfg.fellowContrast,
      amblyopicEye: cfg.amblyopicEye,
      lensOrientation: cfg.lensOrientation,
      screenMethod: cfg.screenMethod,
      notes: reason || ''
    });
  }

  function endSession(reason) {
    if (phase === 'over') return;
    const wasPlaying = phase === 'playing' || phase === 'paused';
    phase = 'over';
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (wasPlaying) saveSession(reason);
    draw();
    updateHud(true);
    showGameOver(reason);
    if (wasPlaying) announceNow(endHeading(reason) + '. ' + statusLine());
  }

  function gameOver(reason) {
    endSession(reason || 'game over');
  }

  function showPaused() {
    showOverlay((el) => {
      const h = document.createElement('h2');
      h.textContent = 'Paused';
      const p = document.createElement('p');
      p.className = 'subtle';
      p.style.margin = '0';
      p.textContent = 'Timer is stopped while paused.';
      const resume = document.createElement('button');
      resume.className = 'btn--primary btn--full';
      resume.style.maxWidth = '320px';
      resume.textContent = 'Resume';
      resume.addEventListener('click', () => {
        resume.blur();
        togglePause();
      });
      const stop = document.createElement('button');
      stop.className = 'btn--full';
      stop.style.maxWidth = '320px';
      stop.textContent = 'End session';
      stop.addEventListener('click', () => {
        stop.blur();
        endSession('stopped');
      });
      el.append(h, p, resume, stop);
    });
  }

  function showGameOver(reason) {
    showOverlay((el) => {
      const h = document.createElement('h2');
      h.textContent = endHeading(reason);

      const dl = document.createElement('dl');
      dl.className = 'kv';
      dl.style.maxWidth = '260px';
      dl.style.width = '100%';
      dl.innerHTML = `
        <dt>Score</dt><dd>${score}</dd>
        <dt>Level</dt><dd>${level}</dd>
        <dt>Lines</dt><dd>${lines}</dd>
        <dt>Practice time</dt><dd>${fmtDuration((sessionMs - remainingMs) / 1000)}</dd>
        <dt>Fellow contrast</dt><dd>${Math.round(cfg.fellowContrast * 100)}%</dd>
      `;

      const note = document.createElement('p');
      note.className = 'faint';
      note.style.margin = '0';
      note.textContent = saved ? 'Session saved to your log.' : 'Session too short to log.';

      const again = document.createElement('button');
      again.className = 'btn--primary btn--full';
      again.style.maxWidth = '320px';
      again.textContent = 'Play again';
      again.addEventListener('click', () => {
        again.blur();
        startSession();
      });

      const menu = document.createElement('button');
      menu.className = 'btn--full';
      menu.style.maxWidth = '320px';
      menu.textContent = 'Back to menu';
      menu.addEventListener('click', () => {
        menu.blur();
        location.hash = '#games';
      });

      el.append(h, dl, note, again, menu);
    });
  }

  function togglePause() {
    if (phase === 'playing') {
      phase = 'paused';
      pauseBtn.textContent = 'Resume';
      showPaused();
      announceNow('Paused. The timer is stopped. ' + statusLine());
    } else if (phase === 'paused') {
      phase = 'playing';
      lastTime = 0;
      pauseBtn.textContent = 'Pause';
      clearOverlay();
      announceNow('Resumed. ' + statusLine());
      if (!rafId) rafId = requestAnimationFrame(frame);
    }
  }

  /* ---------- Input ---------- */

  const KEY_ACTIONS = {
    ArrowLeft: () => move(-1),
    KeyA: () => move(-1),
    ArrowRight: () => move(1),
    KeyD: () => move(1),
    ArrowDown: () => softDrop(),
    KeyS: () => softDrop(),
    ArrowUp: () => rotate(1),
    KeyW: () => rotate(1),
    KeyX: () => rotate(1),
    KeyZ: () => rotate(-1),
    Space: () => hardDrop(),
    KeyP: () => togglePause()
  };

  function onKeyDown(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    if (ev.code === 'Escape') {
      if (phase === 'playing' || phase === 'paused') {
        ev.preventDefault();
        endSession('stopped');
      }
      return;
    }

    if (ev.code === 'KeyP') {
      if (phase === 'playing' || phase === 'paused') {
        ev.preventDefault();
        togglePause();
      }
      return;
    }

    if (phase !== 'playing') {
      if (ev.code === 'Space' && phase === 'over') {
        // Let the buttons handle it; avoid scrolling the page.
        ev.preventDefault();
      }
      return;
    }

    const action = KEY_ACTIONS[ev.code];
    if (!action) return;
    ev.preventDefault();
    action();
  }

  window.addEventListener('keydown', onKeyDown);

  /* ----- On-screen buttons ----- */

  const repeatTimers = new Map();

  function clearRepeats() {
    for (const [, t] of repeatTimers) {
      clearTimeout(t.timeout);
      clearInterval(t.interval);
    }
    repeatTimers.clear();
  }

  function doPadAction(key) {
    if (phase !== 'playing') return;
    if (key === 'left') move(-1);
    else if (key === 'right') move(1);
    else if (key === 'rotate') rotate(1);
    else if (key === 'soft') softDrop();
    else if (key === 'hard') hardDrop();
  }

  for (const def of padButtons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = def.label;
    b.setAttribute('aria-label', def.aria);
    if (def.key === 'hard') b.className = 'tp-hard';

    b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      b.blur();
      doPadAction(def.key);
      // Hold-to-repeat for movement and soft drop.
      if (def.key === 'left' || def.key === 'right' || def.key === 'soft') {
        clearRepeats();
        const timeout = setTimeout(() => {
          const interval = setInterval(() => doPadAction(def.key), def.key === 'soft' ? 60 : 90);
          repeatTimers.set(def.key, { timeout, interval });
        }, 200);
        repeatTimers.set(def.key, { timeout, interval: 0 });
      }
    });

    const stop = () => clearRepeats();
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointercancel', stop);
    b.addEventListener('pointerleave', stop);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());

    pad.appendChild(b);
  }

  /* ----- Swipe gestures on the canvas ----- */

  let touchStart = null;

  function onPointerDown(ev) {
    if (phase !== 'playing') return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    touchStart = { x: ev.clientX, y: ev.clientY, t: performance.now(), moved: 0 };
  }

  function onPointerUp(ev) {
    if (!touchStart) return;
    const s = touchStart;
    touchStart = null;
    if (phase !== 'playing') return;

    const dx = ev.clientX - s.x;
    const dy = ev.clientY - s.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    const minSwipe = 24;
    if (adx < minSwipe && ady < minSwipe) {
      rotate(1); // tap = rotate
      return;
    }

    if (adx > ady) {
      const steps = Math.min(5, Math.max(1, Math.round(adx / (layout.cell * 0.9))));
      for (let i = 0; i < steps; i++) move(dx > 0 ? 1 : -1);
    } else if (dy > 0) {
      const steps = Math.min(12, Math.max(1, Math.round(dy / Math.max(18, layout.cell))));
      for (let i = 0; i < steps; i++) {
        if (!softDrop()) break;
      }
    } else {
      hardDrop();
    }
  }

  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointerup', onPointerUp);
  wrap.addEventListener('pointercancel', () => {
    touchStart = null;
  });

  /* ----- HUD buttons ----- */

  pauseBtn.addEventListener('click', () => {
    pauseBtn.blur();
    togglePause();
  });

  quitBtn.addEventListener('click', () => {
    quitBtn.blur();
    if (phase === 'playing' || phase === 'paused') endSession('stopped');
  });

  /* ---------- Layout observer ---------- */

  function relayout() {
    applyLayout();
    if (phase === 'playing' || phase === 'paused') draw();
    if (phase === 'ready' || phase === 'over') draw();
  }

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => relayout());
    ro.observe(stage);
    disposeLayoutObserver = () => ro.disconnect();
  }
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', relayout);

  /* ---------- Mount + start ---------- */

  root.appendChild(screen);
  applyLayout();
  updateHud();
  draw();

  // Plain, non-diagnostic start overlay. The readiness screen (#readiness)
  // explains the split image; this only confirms the user wants to begin.
  function showReady() {
    showOverlay((el) => {
      const h = document.createElement('h2');
      h.textContent = 'Falling blocks';
      const p = document.createElement('p');
      p.className = 'subtle';
      p.style.margin = '0';
      p.style.maxWidth = '320px';
      p.textContent =
        'Both lenses on. The image is split between your eyes. Stop if you notice double vision or discomfort.';
      const start = document.createElement('button');
      start.className = 'btn--primary btn--full';
      start.style.maxWidth = '320px';
      start.textContent = 'Start';
      start.addEventListener('click', () => {
        start.blur();
        startSession();
      });
      const readyInfo = document.createElement('button');
      readyInfo.className = 'btn--ghost btn--full';
      readyInfo.style.maxWidth = '320px';
      readyInfo.textContent = 'Readiness and observations';
      readyInfo.addEventListener('click', () => {
        readyInfo.blur();
        location.hash = '#readiness';
      });
      const back = document.createElement('button');
      back.className = 'btn--ghost btn--full';
      back.style.maxWidth = '320px';
      back.textContent = 'Back to menu';
      back.addEventListener('click', () => {
        back.blur();
        location.hash = '#games';
      });
      el.append(h, p, start, readyInfo, back);
    });
  }

  showReady();

  /* ---------- Teardown ---------- */

  return function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clearAnnounceTimer();
    announceBuilder = null;

    if (phase === 'playing' || phase === 'paused') {
      // Navigating away mid-session still records the practice time.
      saveSession('abandoned');
      phase = 'over';
    }

    clearRepeats();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', relayout);
    window.removeEventListener('orientationchange', relayout);
    wrap.removeEventListener('pointerdown', onPointerDown);
    wrap.removeEventListener('pointerup', onPointerUp);
    if (disposeLayoutObserver) disposeLayoutObserver();
    clearOverlay();
    screen.remove();
    void ctx; // ctx is reserved for future cross-screen navigation
  };
}

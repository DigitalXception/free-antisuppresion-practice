/*!
 * targets.js — static, original shapes used by the guided binocular
 * observations and by the calibration leakage patch.
 *
 * Everything here is drawn through AnaglyphRenderer, so the current lens
 * orientation, channel colours and per-eye trims apply automatically.
 *
 * Eye tags used:
 *   'leftFull' / 'rightFull' — a single physical eye, at that eye's full
 *      brightness trim. fellowContrast is deliberately NOT applied: these
 *      targets exist to ask "can this eye see this at all?", so dimming the
 *      content by the fellow-eye contrast setting would confound the answer.
 *   'both' — identical content in both eyes (zero disparity).
 *
 * There is no motion, no animation, no flashing and no disparity/offset
 * between positions: every function is a pure draw into the renderer's
 * buffers, called only when the canvas is painted or repainted.
 */

/** Ring + solid core target used by the screen / glasses check. */
export function drawScreenCheckTarget(r, w, h, eyeTag) {
  const cx = w / 2;
  const cy = h / 2;
  const size = Math.min(w, h);

  const ringR = size * 0.24;
  const thickness = Math.max(3, Math.round(size * 0.022));
  const gap = thickness * 2.4;

  // Hollow ring: an outline makes edge clarity (and ghosting) easy to judge.
  r.drawRing(cx, cy, ringR, thickness, eyeTag);

  // Solid core square inside the ring.
  const sq = ringR * 0.95;
  r.drawRect(cx - sq / 2, cy - sq / 2, sq, sq, eyeTag);

  // Base bar below the ring.
  const barW = ringR * 1.7;
  const barH = Math.max(3, Math.round(thickness * 1.4));
  r.drawRect(cx - barW / 2, cy + ringR + gap, barW, barH, eyeTag);

  // Two short ticks above the ring (this prototype's own marker, so the
  // target is not mistaken for a clinical symbol).
  const tickW = Math.max(3, Math.round(thickness * 1.2));
  const tickH = Math.max(6, Math.round(ringR * 0.28));
  r.drawRect(cx - ringR * 0.45 - tickW / 2, cy - ringR - gap - tickH, tickW, tickH, eyeTag);
  r.drawRect(cx + ringR * 0.45 - tickW / 2, cy - ringR - gap - tickH, tickW, tickH, eyeTag);
}

/**
 * Two game-like targets: a falling-piece shape and a small landed stack.
 * Used by the target-visibility step.
 *
 * @param {{pieceEye: string, stackEye: string, frameEye: string}} eyes
 *        eye tags per element. There is no disparity, offset or motion: the
 *        shapes always occupy the same screen positions, whichever eye(s) they
 *        are drawn to. Positions never move between modes.
 */
export function drawGameTargets(r, w, h, eyes) {
  const unit = Math.max(6, Math.min(w * 0.075, h * 0.11));
  const groundY = Math.round(h * 0.76);

  // Ground line + centre fixation mark. When frameEye is 'both' these are
  // identical in each eye, so they add no disparity and no motion.
  const lineH = Math.max(2, Math.round(unit * 0.12));
  r.drawRect(Math.round(w * 0.08), groundY, Math.round(w * 0.84), lineH, eyes.frameEye);
  const fixH = Math.max(6, Math.round(unit * 0.5));
  const fixT = Math.max(2, Math.round(unit * 0.12));
  r.drawRect(w / 2 - fixT / 2, groundY - fixH - unit * 0.35, fixT, fixH, eyes.frameEye);

  const pieceCells = [
    [0, 1],
    [1, 1],
    [2, 1],
    [2, 0]
  ];
  const stackCells = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1]
  ];

  function blocks(cells, centreX, eye) {
    const inset = unit >= 12 ? 1 : 0;
    const bw = unit - inset * 2;
    const originX = centreX - (3 * unit) / 2;
    const originY = groundY - unit * 2;
    for (let i = 0; i < cells.length; i++) {
      const x = originX + cells[i][0] * unit;
      const y = originY + cells[i][1] * unit;
      r.drawRect(x + inset, y + inset, bw, bw, eye);
    }
  }

  blocks(pieceCells, w * 0.3, eyes.pieceEye);
  blocks(stackCells, w * 0.7, eyes.stackEye);
}

/**
 * Four-dot pattern.
 *
 * mode 'demo'    — every dot drawn to both eyes, so the layout can be shown
 *                  before any channel assignment is involved.
 * mode 'observe' — dot assignments as documented below.
 *
 * Assignment (this prototype's own, not a clinical test):
 *   top dot    → both eyes (shared)
 *   left dot   → left channel only
 *   bottom dot → left channel only
 *   right dot  → right channel only
 */
export function drawFourDotPattern(r, w, h, mode) {
  const cx = w / 2;
  const cy = h / 2;
  const spread = Math.min(w * 0.2, h * 0.28);
  const rad = Math.max(5, Math.min(w, h) * 0.055);

  // Shared frame: identical in both eyes, no disparity, no motion.
  const frameT = Math.max(2, Math.round(rad * 0.3));
  r.drawFrame(
    Math.round(cx - spread - rad * 2),
    Math.round(cy - spread - rad * 2),
    Math.round((spread + rad * 2) * 2),
    Math.round((spread + rad * 2) * 2),
    frameT,
    'both'
  );

  const observe = mode === 'observe';
  const dots = [
    { x: cx, y: cy - spread, eye: 'both' }, // shared
    { x: cx - spread, y: cy, eye: observe ? 'leftFull' : 'both' },
    { x: cx, y: cy + spread, eye: observe ? 'leftFull' : 'both' },
    { x: cx + spread, y: cy, eye: observe ? 'rightFull' : 'both' }
  ];

  for (let i = 0; i < dots.length; i++) {
    r.drawCircle(dots[i].x, dots[i].y, rad, dots[i].eye);
  }
}

/** Description of the four-dot assignment, shared by the UI legend and CSV. */
export const FOUR_DOT_ASSIGNMENT = [
  { key: 'top', position: 'Top dot', channel: 'both', text: 'shared — drawn to both eyes' },
  { key: 'left', position: 'Left dot', channel: 'left', text: 'left channel only' },
  { key: 'bottom', position: 'Bottom dot', channel: 'left', text: 'left channel only' },
  { key: 'right', position: 'Right dot', channel: 'right', text: 'right channel only' }
];

/** Small illustration of how the image is split between the two eyes. */
export function drawSplitDemo(r, w, h) {
  const pad = Math.round(Math.min(w, h) * 0.06);
  const boxW = Math.round((w - pad * 3) / 2);
  const boxH = Math.round(h - pad * 2);

  // Shared frame around both halves.
  r.drawFrame(pad - 4, pad - 4, w - pad * 2 + 8, boxH + 8, 2, 'both');

  // Left half: left-eye channel content (three stacked bars).
  const barH = Math.max(4, Math.round(boxH * 0.12));
  for (let i = 0; i < 3; i++) {
    r.drawRect(pad + 6, pad + boxH * 0.2 + i * barH * 2, boxW - 12, barH, 'leftFull');
  }

  // Right half: right-eye channel content (a block cluster).
  const unit = Math.max(6, Math.round(Math.min(boxW, boxH) * 0.14));
  const ox = pad * 2 + boxW;
  const oy = pad + boxH * 0.2;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      if ((x + y) % 2) continue;
      r.drawRect(ox + 6 + x * unit, oy + y * unit, unit - 2, unit - 2, 'rightFull');
    }
  }

  // Shared centre mark (identical in both eyes).
  const tickT = Math.max(3, Math.round(Math.min(w, h) * 0.012));
  r.drawRect(w / 2 - tickT / 2, pad, tickT, boxH, 'both');
}

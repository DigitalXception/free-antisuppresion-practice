/*!
 * display.js — canvas sizing (HiDPI aware), physical screen size estimation,
 * degrees→pixels conversion, and the credit-card calibration UI.
 */

import { getSettings, saveSettings } from './store.js';

/* ---------- Canvas setup ---------- */

/**
 * Prepare a canvas for crisp rendering: backing store = CSS size × dpr.
 * Returns the 2d context (already scaled). Contexts are cached per canvas so
 * repeated calls never stack transforms.
 */
const ctxCache = new WeakMap();
const observerCache = new WeakMap();

export function setupCanvas(canvas, options = {}) {
  const alpha = options.alpha !== undefined ? options.alpha : false;
  let ctx = ctxCache.get(canvas);

  if (!ctx) {
    ctx = canvas.getContext('2d', { alpha, desynchronized: true });
    ctxCache.set(canvas, ctx);
  }

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height || cssW));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    // Reset and re-apply scale (setTransform is idempotent, unlike scale()).
    ctx.setTransform(bw / cssW, 0, 0, bh / cssH, 0, 0);
    ctx.imageSmoothingEnabled = true;
  };

  resize();

  if (!observerCache.has(canvas) && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);
    observerCache.set(canvas, ro);
  }

  // Expose the logical CSS size on the context for convenience.
  ctx.cssSize = () => {
    const rect = canvas.getBoundingClientRect();
    return { w: Math.max(1, Math.round(rect.width)), h: Math.max(1, Math.round(rect.height)) };
  };

  return ctx;
}

/** Force a resize pass (e.g. after layout changes / orientation change). */
export function refreshCanvas(canvas) {
  const ctx = ctxCache.get(canvas);
  if (!ctx) return setupCanvas(canvas);
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height || cssW));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/* ---------- Physical size estimation ---------- */

const MM_PER_PX_MOBILE = 0.165;
const MM_PER_PX_DESKTOP = 0.2646;

export function isLikelyMobile() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    return navigator.userAgentData.mobile;
  }
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|Opera Mini/i.test(ua);
  const coarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const narrow = Math.min(window.innerWidth, window.innerHeight) <= 820;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  return uaMobile || (coarse && hasTouch && narrow);
}

/**
 * Estimate millimetres per CSS pixel from the device class, persist it, and
 * return it. Card calibration overrides this with method 'card'.
 */
export function estimateScreenSize() {
  const settings = getSettings();
  if (settings.screenMethod === 'card' && settings.screenMmPerPx) {
    return settings.screenMmPerPx;
  }
  const mmPerPx = isLikelyMobile() ? MM_PER_PX_MOBILE : MM_PER_PX_DESKTOP;
  saveSettings({ screenMmPerPx: mmPerPx, screenMethod: 'guessed' });
  return mmPerPx;
}

/** Current mm/px, estimating and storing if not yet known. */
export function getMmPerPx() {
  const s = getSettings();
  if (s.screenMmPerPx && s.screenMmPerPx > 0) return s.screenMmPerPx;
  return estimateScreenSize();
}

/** Visual angle (degrees) → CSS pixels. */
export function degToPx(degrees) {
  const s = getSettings();
  const mmPerPx = s.screenMmPerPx && s.screenMmPerPx > 0 ? s.screenMmPerPx : estimateScreenSize();
  const distanceMm = s.viewingDistanceCm * 10;
  // tan(theta) * distance = physical size in mm → px
  const mm = Math.tan((degrees * Math.PI) / 180) * distanceMm;
  return mm / mmPerPx;
}

/** Inverse: CSS pixels → degrees of visual angle. */
export function pxToDeg(px) {
  const s = getSettings();
  const mmPerPx = s.screenMmPerPx && s.screenMmPerPx > 0 ? s.screenMmPerPx : estimateScreenSize();
  const distanceMm = s.viewingDistanceCm * 10;
  const mm = px * mmPerPx;
  return (Math.atan(mm / distanceMm) * 180) / Math.PI;
}

/** Human readable description of the current size estimate. */
export function describeScreenSize() {
  const s = getSettings();
  const mm = s.screenMmPerPx;
  if (!mm) return 'not yet estimated';
  const method = s.screenMethod === 'card' ? 'card calibration' : 'auto-guessed from device class';
  return `${mm.toFixed(4)} mm per CSS px (${method})`;
}

/* ---------- Card calibration UI ---------- */

const CARD_W_MM = 85.60; // ISO/IEC 7810 ID-1
const CARD_H_MM = 53.98;

/**
 * Mount the card calibration widget into `container`.
 * The user drags the bottom-right corner (or a resize handle) until the
 * rectangle matches a real payment card; we then derive mm per CSS pixel.
 *
 * @param {HTMLElement} container
 * @param {{onDone?: (mmPerPx:number)=>void, onCancel?: ()=>void}} [opts]
 * @returns {{el: HTMLElement, destroy: () => void}}
 */
export function cardCalibration(container, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'stack';

  const hint = document.createElement('p');
  hint.className = 'instructions';
  hint.textContent =
    'Hold a real bank card / ID card against the screen. Drag the bottom-right corner of the white rectangle until it is exactly the same size as the card. Then tap “Save size”.';

  const outer = document.createElement('div');
  outer.className = 'calib-outer';

  const card = document.createElement('div');
  card.className = 'calib-card';
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'Card calibration rectangle — drag bottom-right corner to resize');
  card.tabIndex = 0;

  const label = document.createElement('span');
  label.textContent = '';
  card.appendChild(label);

  const handle = document.createElement('div');
  handle.style.cssText =
    'position:absolute;right:-10px;bottom:-10px;width:28px;height:28px;border-radius:50%;background:#4fb3ff;border:2px solid #111;box-shadow:0 0 0 1px #4fb3ff;cursor:nwse-resize;touch-action:none;';
  card.appendChild(handle);

  outer.appendChild(card);

  const readout = document.createElement('div');
  readout.className = 'subtle mono';

  const actions = document.createElement('div');
  actions.className = 'calib-sticky';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn--primary';
  saveBtn.textContent = 'Save size';

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn--ghost';
  cancelBtn.textContent = 'Cancel';

  actions.append(saveBtn, resetBtn, cancelBtn);

  wrap.append(hint, outer, readout, actions);

  // Start at a plausible physical size using the current estimate.
  const startMmPerPx = getSettings().screenMmPerPx || (isLikelyMobile() ? MM_PER_PX_MOBILE : MM_PER_PX_DESKTOP);
  let widthCss = CARD_W_MM / startMmPerPx;

  // Clamp so it always fits the viewport.
  const maxW = Math.max(140, Math.min(window.innerWidth - 90, 620));
  widthCss = Math.min(widthCss, maxW);
  let aspect = CARD_H_MM / CARD_W_MM;

  function apply() {
    card.style.width = widthCss + 'px';
    card.style.height = widthCss * aspect + 'px';
    const mmPerPx = CARD_W_MM / widthCss;
    label.textContent = `${widthCss.toFixed(0)} px wide`;
    readout.textContent = `≈ ${mmPerPx.toFixed(4)} mm per CSS px · card ${CARD_W_MM} × ${CARD_H_MM} mm`;
    return mmPerPx;
  }

  let currentMmPerPx = apply();

  let dragging = false;
  let startX = 0;
  let startW = 0;

  function pointerDown(ev) {
    dragging = true;
    startX = ev.clientX;
    startW = widthCss;
    card.setPointerCapture?.(ev.pointerId);
    ev.preventDefault();
  }

  function pointerMove(ev) {
    if (!dragging) return;
    const dx = ev.clientX - startX;
    const next = Math.max(120, Math.min(maxW * 1.6, startW + dx));
    widthCss = next;
    currentMmPerPx = apply();
    ev.preventDefault();
  }

  function pointerUp() {
    dragging = false;
  }

  handle.addEventListener('pointerdown', pointerDown);
  card.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  window.addEventListener('pointercancel', pointerUp);

  // Keyboard nudging for accessibility.
  card.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') {
      widthCss = Math.min(maxW * 1.6, widthCss + 2);
    } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') {
      widthCss = Math.max(120, widthCss - 2);
    } else {
      return;
    }
    ev.preventDefault();
    currentMmPerPx = apply();
  });

  function cleanup() {
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerUp);
    wrap.remove();
  }

  saveBtn.addEventListener('click', () => {
    const mmPerPx = CARD_W_MM / widthCss;
    saveSettings({ screenMmPerPx: mmPerPx, screenMethod: 'card' });
    cleanup();
    opts.onDone?.(mmPerPx);
  });

  resetBtn.addEventListener('click', () => {
    widthCss = Math.min(CARD_W_MM / MM_PER_PX_DESKTOP, maxW);
    currentMmPerPx = apply();
  });

  cancelBtn.addEventListener('click', () => {
    cleanup();
    opts.onCancel?.();
  });

  container.appendChild(wrap);

  return {
    el: wrap,
    destroy: cleanup,
    getMmPerPx: () => currentMmPerPx
  };
}

/** Simple full-screen modal host for the calibration widget. */
export function openCardCalibration(onDone) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const h = document.createElement('h2');
  h.textContent = 'Card calibration';

  const body = document.createElement('div');
  body.style.cssText = 'max-height:60vh;overflow:auto;';

  modal.append(h, body);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  cardCalibration(body, {
    onDone: (mm) => {
      close();
      onDone?.(mm);
    },
    onCancel: close
  });

  return { close };
}

export default { setupCanvas, degToPx, cardCalibration };

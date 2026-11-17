/*!
 * calibration.js — lens orientation, eye colours, trims, fellow contrast,
 * leakage check, screen size.
 *
 * The former "alignment check" section has been removed: a browser cannot
 * verify physical/ocular alignment, and the offset-line instruction implied it
 * could. Observations are now an explicit, optional, self-reported flow under
 * #observations, linked from here.
 */

import { getSettings, saveSettings } from '../store.js';
import {
  estimateScreenSize,
  degToPx,
  describeScreenSize,
  isLikelyMobile,
  openCardCalibration
} from '../display.js';
import { AnaglyphRenderer } from '../anaglyph.js';

/* ---------- Small UI helpers ---------- */

function section(title, subtitle) {
  const el = document.createElement('section');
  el.className = 'card';
  if (title) {
    const h = document.createElement('h2');
    h.textContent = title;
    el.appendChild(h);
  }
  if (subtitle) {
    const p = document.createElement('p');
    p.className = 'subtle';
    p.style.margin = '0';
    p.textContent = subtitle;
    el.appendChild(p);
  }
  return el;
}

function sliderField({ label, min, max, step, value, format, onInput, className }) {
  const field = document.createElement('div');
  field.className = 'field';

  const lab = document.createElement('div');
  lab.className = 'field__label';

  const span = document.createElement('span');
  span.textContent = label;

  const val = document.createElement('span');
  val.className = 'field__value';
  val.textContent = format ? format(value) : String(value);

  lab.append(span, val);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  if (className) input.className = className;
  input.setAttribute('aria-label', label);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = format ? format(v) : String(v);
    onInput(v);
  });

  field.append(lab, input);
  field.setValue = (v) => {
    input.value = String(v);
    val.textContent = format ? format(v) : String(v);
  };
  return field;
}

function segmented(options, current, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'btn-grid btn-grid--2';
  const buttons = [];

  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opt.label;
    if (opt.sub) {
      const s = document.createElement('span');
      s.className = 'faint';
      s.style.display = 'block';
      s.textContent = opt.sub;
      b.appendChild(s);
    }
    b.dataset.value = opt.value;
    if (opt.value === current) b.classList.add('btn--selected');
    b.addEventListener('click', () => {
      for (const other of buttons) other.classList.remove('btn--selected');
      b.classList.add('btn--selected');
      onPick(opt.value);
    });
    buttons.push(b);
    wrap.appendChild(b);
  }
  return wrap;
}

/* ---------- Screen ---------- */

export function mountCalibration(root) {
  let settings = getSettings();

  // Make sure we always have a screen size estimate to show.
  if (!settings.screenMmPerPx) {
    estimateScreenSize();
    settings = getSettings();
  }

  const screen = document.createElement('div');
  screen.className = 'screen';

  const header = document.createElement('div');
  header.className = 'stack';
  header.innerHTML = `
    <h1>Calibration</h1>
    <p class="subtle">Balance the two eyes, then verify your screen setup. Changes save instantly.</p>
  `;

  /* ---- 1. Lens orientation ---- */
  const s1 = section('1. Lens orientation', 'Which eye has the red lens?');
  s1.appendChild(
    segmented(
      [
        { value: 'RL', label: 'Red Left / Cyan Right', sub: 'red lens over your left eye' },
        { value: 'LR', label: 'Red Right / Cyan Left', sub: 'red lens over your right eye' }
      ],
      settings.lensOrientation,
      (v) => {
        settings = saveSettings({ lensOrientation: v });
        renderPreview();
        renderLeak();
      }
    )
  );

  /* ---- 2. Amblyopic eye ---- */
  const s2 = section('2. Which eye is weaker?', 'The “amblyopic” eye gets full-contrast content.');
  s2.appendChild(
    segmented(
      [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
        { value: 'equal', label: 'Equal', sub: 'Equal contrast — no offset, demo only' }
      ],
      settings.amblyopicEye,
      (v) => {
        settings = saveSettings({ amblyopicEye: v });
        renderPreview();
        renderEqualNote();
        renderLeak();
      }
    )
  );

  /* ---- Preview canvas (shared by 3, 4, 5) ---- */
  const previewWrap = document.createElement('div');
  previewWrap.className = 'canvas-wrap';
  const previewCanvas = document.createElement('canvas');
  previewCanvas.style.width = '100%';
  previewCanvas.style.height = '190px';
  previewWrap.appendChild(previewCanvas);

  /* ---- 3. Per-eye colour ---- */
  const s3 = section(
    '3. Per-eye colour adjustment',
    'Tune until each eye sees a similarly bright image through its lens.'
  );
  s3.appendChild(previewWrap);

  const redField = sliderField({
    label: 'Red-lens red channel (R)',
    min: 0,
    max: 255,
    step: 1,
    value: settings.redColor.r,
    className: 'slider--red',
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      settings = saveSettings({ redColor: { ...settings.redColor, r: v } });
      queuePreview();
      renderLeak();
    }
  });

  const greenField = sliderField({
    label: 'Cyan-lens green channel (G)',
    min: 0,
    max: 255,
    step: 1,
    value: settings.cyanColor.g,
    className: 'slider--green',
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      settings = saveSettings({ cyanColor: { ...settings.cyanColor, g: v } });
      queuePreview();
      renderLeak();
    }
  });

  const blueField = sliderField({
    label: 'Cyan-lens blue channel (B)',
    min: 0,
    max: 255,
    step: 1,
    value: settings.cyanColor.b,
    className: 'slider--blue',
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      settings = saveSettings({ cyanColor: { ...settings.cyanColor, b: v } });
      queuePreview();
      renderLeak();
    }
  });

  s3.append(redField, greenField, blueField);

  const resetColors = document.createElement('button');
  resetColors.textContent = 'Reset colours';
  resetColors.addEventListener('click', () => {
    settings = saveSettings({
      redColor: { r: 255, g: 0, b: 0 },
      cyanColor: { r: 0, g: 255, b: 255 }
    });
    redField.setValue(settings.redColor.r);
    greenField.setValue(settings.cyanColor.g);
    blueField.setValue(settings.cyanColor.b);
    renderPreview();
    renderLeak();
  });
  s3.appendChild(resetColors);

  /* ---- 4. Brightness trims ---- */
  const s4 = section('4. Per-eye brightness trim', 'Reduce the stronger eye if it dominates.');
  const leftTrim = sliderField({
    label: 'Left eye brightness',
    min: 0.3,
    max: 1.0,
    step: 0.01,
    value: settings.leftEyeTrim,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => {
      settings = saveSettings({ leftEyeTrim: v });
      queuePreview();
      renderLeak();
    }
  });
  const rightTrim = sliderField({
    label: 'Right eye brightness',
    min: 0.3,
    max: 1.0,
    step: 0.01,
    value: settings.rightEyeTrim,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => {
      settings = saveSettings({ rightEyeTrim: v });
      queuePreview();
      renderLeak();
    }
  });
  s4.append(leftTrim, rightTrim);

  /* ---- 5. Fellow-eye contrast ---- */
  const s5 = section(
    '5. Fellow-eye contrast',
    'Controls how much the elements assigned to the fellow eye are dimmed on screen. Lower reduces the contrast of those elements. This setting does not measure or change suppression.'
  );
  const contrastField = sliderField({
    label: 'Fellow-eye contrast',
    min: 0.05,
    max: 1.0,
    step: 0.01,
    value: settings.fellowContrast,
    format: (v) => Math.round(v * 100) + '%',
    onInput: (v) => {
      settings = saveSettings({ fellowContrast: v });
      queuePreview();
      renderLeak();
    }
  });
  s5.appendChild(contrastField);

  // Built once, shown/hidden in place so switching eye mode needs no reload.
  const equalNote = document.createElement('p');
  equalNote.className = 'dirty-note';
  equalNote.textContent =
    'You selected “Equal”. Fellow-eye contrast has no effect while the eyes are set to equal.';

  /** Show the Equal-mode note only while the eye mode is actually 'equal'. */
  function renderEqualNote() {
    const shouldShow = settings.amblyopicEye === 'equal';
    const isShown = equalNote.parentNode === s5;
    if (shouldShow && !isShown) s5.appendChild(equalNote);
    else if (!shouldShow && isShown) equalNote.remove();
  }

  /* ---- 6. Leakage check ---- */
  const s6 = section(
    '6. Leakage check (approximate)',
    'A subjective, approximate check only. Coloured-filter glasses cannot fully isolate the two eyes’ images, so some crossover is expected.'
  );
  const leakInstructions = document.createElement('p');
  leakInstructions.className = 'instructions';
  leakInstructions.textContent =
    'Both lenses stay on your face. To judge how much of one eye’s light reaches the other eye, COVER the eye you are assessing with your hand or a card and KEEP the other eye open. Never try to look through a closed eye. Use the button below to switch which physical eye is being shown; the target is drawn at that eye’s full intended brightness.';

  const leakPatch = document.createElement('canvas');
  leakPatch.className = 'leak-patch';
  // Static patch: sized/redrawn only on layout, DPR or settings changes.
  leakPatch.width = 300;
  leakPatch.height = 300;
  leakPatch.style.maxWidth = '320px';
  leakPatch.setAttribute('role', 'img');
  leakPatch.setAttribute(
    'aria-label',
    'Static coloured patch used to check how much light from one eye reaches the other.'
  );

  const leakBtn = document.createElement('button');
  leakBtn.className = 'btn--full';

  const leakHint = document.createElement('p');
  leakHint.className = 'faint';

  let leakEye = 'left'; // physical eye the patch is intended for

  const leakRenderer = new AnaglyphRenderer(document.createElement('canvas'));
  // The renderer needs a sized canvas; we draw directly to the patch instead.
  const leakCtx = leakPatch.getContext('2d', { alpha: false });

  // Backing-store state, so we only resize/repaint when something changed.
  let leakCssW = 0;
  let leakCssH = 0;
  let leakDpr = 0;
  let leakQueued = false;
  let leakDisposed = false;

  /** Match the backing store to the CSS box × devicePixelRatio (capped at 3). */
  function sizeLeakPatch() {
    const cssW = Math.max(1, Math.round(leakPatch.clientWidth || 0) || 300);
    const cssH = Math.max(1, Math.round(leakPatch.clientHeight || 0) || cssW);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));

    if (leakPatch.width !== bw || leakPatch.height !== bh) {
      leakPatch.width = bw;
      leakPatch.height = bh;
    }
    // Draw in CSS pixels; the transform handles the DPR scale.
    leakCtx.setTransform(bw / cssW, 0, 0, bh / cssH, 0, 0);

    leakCssW = cssW;
    leakCssH = cssH;
    leakDpr = dpr;
    return { cssW, cssH };
  }

  function renderLeak() {
    leakQueued = false;
    if (leakDisposed) return;
    const { cssW, cssH } = sizeLeakPatch();
    const r = leakRenderer;
    r.configure(settings);
    // Full-strength colour for the eye the patch is intended for: per-eye trim
    // only, never fellowContrast, so the check is not confounded by dimming.
    const color = r.colorFor(leakEye === 'left' ? 'leftFull' : 'rightFull');
    const otherEye = leakEye === 'left' ? 'right' : 'left';

    leakCtx.fillStyle = '#000';
    leakCtx.fillRect(0, 0, cssW, cssH);
    leakCtx.fillStyle = color;
    const pad = cssW * 0.15;
    leakCtx.fillRect(pad, pad, cssW - pad * 2, cssH - pad * 2);

    // A soft-textured inner square helps spot leakage of the channel.
    leakCtx.fillRect(cssW * 0.36, cssH * 0.36, cssW * 0.28, cssH * 0.28);

    leakBtn.textContent = `Patch intended for the ${leakEye.toUpperCase()} eye — switch eye`;
    leakBtn.setAttribute(
      'aria-label',
      `Patch intended for the ${leakEye} eye. Activate to switch to the ${otherEye} eye.`
    );
    leakHint.textContent = `Cover your ${otherEye.toUpperCase()} eye and keep the ${leakEye.toUpperCase()} eye open to judge intended visibility, then cover the ${leakEye.toUpperCase()} eye and keep the ${otherEye.toUpperCase()} eye open to judge leakage. Approximate and subjective only.`;
    leakPatch.setAttribute(
      'aria-label',
      `Static patch drawn at full intended strength for the ${leakEye} physical eye.`
    );
  }

  function queueLeak() {
    if (leakQueued || leakDisposed) return;
    leakQueued = true;
    requestAnimationFrame(renderLeak);
  }

  leakBtn.addEventListener('click', () => {
    leakEye = leakEye === 'left' ? 'right' : 'left';
    renderLeak();
  });

  s6.append(leakInstructions, leakPatch, leakBtn, leakHint);

  /* ---- 7. Screen size ---- */
  const s7 = section('7. Screen size', 'Used to convert visual angle (degrees) into pixels.');
  const sizeOut = document.createElement('p');
  sizeOut.className = 'subtle mono';
  sizeOut.style.margin = '0';

  const cardBtn = document.createElement('button');
  cardBtn.className = 'btn--full';
  cardBtn.textContent = 'Calibrate with a bank card';

  const reEstimateBtn = document.createElement('button');
  reEstimateBtn.className = 'btn--ghost btn--full';
  reEstimateBtn.textContent = 'Re-estimate automatically';

  function renderSize() {
    const devClass = isLikelyMobile() ? 'phone/tablet' : 'desktop';
    sizeOut.textContent = `${describeScreenSize()} · device class: ${devClass}`;
  }

  cardBtn.addEventListener('click', () => {
    openCardCalibration(() => {
      settings = getSettings();
      renderSize();
      renderPreview();
      renderLeak();
    });
  });

  reEstimateBtn.addEventListener('click', () => {
    saveSettings({ screenMmPerPx: null, screenMethod: 'guessed' });
    estimateScreenSize();
    settings = getSettings();
    renderSize();
    renderPreview();
  });

  s7.append(sizeOut, cardBtn, reEstimateBtn);

  /* ---- 8. Observations ---- */
  const s8 = section(
    '8. Binocular observations',
    'Optional guided, self-reported observations of static images.'
  );
  s8.append(
    Object.assign(document.createElement('p'), {
      className: 'instructions',
      textContent:
        'The observations flow walks through a screen/glasses check, target visibility per eye, and a generic four-dot pattern. ' +
        'It is not a screening score or a diagnosis, needs no alignment declaration, and is stored separately from game sessions.'
    })
  );
  const obsBtn = document.createElement('button');
  obsBtn.className = 'btn--full';
  obsBtn.textContent = 'Open binocular observations';
  obsBtn.addEventListener('click', () => {
    location.hash = '#observations';
  });
  s8.appendChild(obsBtn);

  /* ---- 9. Save & back ---- */
  const footer = document.createElement('div');
  footer.className = 'stack';

  const savedNote = document.createElement('p');
  savedNote.className = 'faint';
  savedNote.style.margin = '0';
  savedNote.textContent = 'Settings save automatically as you adjust them.';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn--primary btn--full';
  backBtn.textContent = 'Save and back';
  backBtn.addEventListener('click', () => {
    saveSettings(settings);
    location.hash = '#home';
  });

  footer.append(savedNote, backBtn);

  screen.append(header, s1, s2, s3, s4, s5, s6, s7, s8, footer);
  root.appendChild(screen);

  /* ---- Preview rendering ---- */
  const previewRenderer = new AnaglyphRenderer(previewCanvas);
  let previewQueued = false;

  function renderPreview() {
    previewQueued = false;
    const cssW = previewCanvas.clientWidth || 300;
    const cssH = previewCanvas.clientHeight || 190;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (previewCanvas.width !== bw || previewCanvas.height !== bh) {
      previewCanvas.width = bw;
      previewCanvas.height = bh;
    }

    const r = previewRenderer;
    r.configure(settings);
    r.clear();

    const cx = cssW / 2;

    // Dim fused backdrop: a faint grid in both eyes.
    const gridStep = Math.max(18, Math.round(cssW / 16));
    for (let x = 0; x < cssW; x += gridStep) {
      r.drawRect(x, 0, 1, cssH, 'both');
    }
    for (let y = 0; y < cssH; y += gridStep) {
      r.drawRect(0, y, cssW, 1, 'both');
    }

    // Pair of squares, one per eye, so any imbalance is immediately visible.
    const box = Math.min(cssW * 0.26, cssH * 0.46);
    const boxY = cssH * 0.24;
    r.drawRect(cx * 0.5 - box / 2, boxY, box, box, 'amblyopic');
    r.drawRect(cx + cx * 0.5 - box / 2, boxY, box, box, 'fellow');

    // Circles below the squares.
    const rad = Math.min(cx * 0.13, cssH * 0.11);
    r.drawCircle(cx * 0.5, cssH * 0.8, rad, 'amblyopic');
    r.drawCircle(cx + cx * 0.5, cssH * 0.8, rad, 'fellow');

    // Fused centre element (both eyes) — should read near-white when balanced.
    r.drawRect(cx - 2, 0, 4, cssH, 'both');

    // 1-degree tick ruler along the bottom (both eyes).
    const pxPerDeg = degToPx(1);
    if (pxPerDeg > 3 && pxPerDeg < cssW) {
      for (let x = (cx % pxPerDeg); x < cssW; x += pxPerDeg) {
        r.drawRect(x, cssH - 8, 2, 5, 'both');
      }
    }

    r.composite();

    // Eye labels on top (plain text, neutral white).
    const ctx = r.ctx;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(200,200,200,0.75)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('amblyopic eye', cx * 0.5, 4);
    ctx.fillText('fellow eye', cx + cx * 0.5, 4);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(150,150,150,0.6)';
    if (pxPerDeg > 3 && pxPerDeg < cssW) {
      ctx.textAlign = 'left';
      ctx.fillText('1° ticks', 4, cssH - 12);
    }
  }

  function queuePreview() {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(renderPreview);
  }

  // Initial paint after layout settles.
  requestAnimationFrame(() => {
    renderSize();
    renderEqualNote();
    renderPreview();
    renderLeak();
  });

  // The leak patch follows the CSS box (orientation changes, window resizes,
  // responsive breakpoints) and the device pixel ratio. It stays static
  // otherwise — there is no timer or animation driving it.
  let leakObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    leakObserver = new ResizeObserver(() => {
      if (leakPatch.clientWidth === leakCssW && leakPatch.clientHeight === leakCssH) return;
      queueLeak();
    });
    leakObserver.observe(leakPatch);
  }

  const onResize = () => {
    queuePreview();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (dpr !== leakDpr) renderLeak();
    else queueLeak();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  return () => {
    leakDisposed = true;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    if (leakObserver) {
      leakObserver.disconnect();
      leakObserver = null;
    }
    screen.remove();
  };
}

/*!
 * observations.js — guided, self-reported binocular observations.
 *
 * Three optional steps over static images:
 *   1. Screen / glasses check — each physical eye checked separately for the
 *      target intended for it, plus an approximate leakage check.
 *   2. Target visibility — game-like shapes, each eye alone, then both open.
 *   3. Four-dot pattern — a generic, unvalidated browser pattern (explicitly
 *      NOT a clinical Worth-4-Dot test).
 *
 * Design constraints enforced here:
 *   - No diagnosis, classification, severity score, or eye-deviation estimate.
 *   - No motion, flashing, disparity or moving offsets: every canvas is a
 *     static paint, repainted only on resize / DPR / answer change.
 *   - Every step can be skipped, answered "not sure", or exited.
 *   - Records are stored separately from gameplay sessions, with an immutable
 *     settings snapshot taken when the observation starts.
 *   - Nothing here changes persisted settings.
 */

import {
  addObservation,
  getObservations,
  snapshotSettings,
  OBSERVATION_SCHEMA_VERSION
} from '../store.js';
import { AnaglyphRenderer } from '../anaglyph.js';
import {
  drawScreenCheckTarget,
  drawGameTargets,
  drawFourDotPattern,
  FOUR_DOT_ASSIGNMENT,
  drawSplitDemo
} from '../observations/targets.js';

/* ---------- Answer option tables (also used as stored labels) ---------- */

const SCREEN_OPTIONS = [
  ['clear', 'Clear'],
  ['faint', 'Faint'],
  ['absent', 'Absent'],
  ['unsure', 'Not sure']
];

const GHOST_OPTIONS = [
  ['none', 'No extra image'],
  ['ghosting', 'Extra / ghost image'],
  ['unsure', 'Not sure']
];

const VISIBILITY_OPTIONS = [
  ['clear', 'Clear'],
  ['blurred', 'Blurred'],
  ['faint', 'Faint'],
  ['not-visible', 'Not visible'],
  ['unsure', 'Not sure']
];

const BOTH_OPEN_OPTIONS = [
  ['both-visible', 'Both targets visible'],
  ['one-missing', 'One target missing'],
  ['alternating', 'Alternating'],
  ['doubled', 'Doubled / overlapping'],
  ['unsure', 'Not sure']
];

const COUNT_OPTIONS = [
  ['0', '0'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5plus', '5 or more'],
  ['unsure', 'Not sure'],
  ['cannot', 'Cannot do this']
];

const COLOUR_OPTIONS = [
  ['red', 'Red'],
  ['cyan', 'Cyan'],
  ['white-mixed', 'White / mixed'],
  ['other', 'Other'],
  ['unsure', 'Not sure']
];

const DISPLACEMENT_OPTIONS = [
  ['none', 'No displacement noticed'],
  ['horizontal', 'Horizontal separation'],
  ['vertical', 'Vertical separation'],
  ['other', 'Other'],
  ['unsure', 'Not sure']
];

const STABILITY_OPTIONS = [
  ['stable', 'Stable'],
  ['alternating', 'Alternating / changing'],
  ['unsure', 'Not sure']
];

/* ---------- Tiny DOM helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fieldset(legendText, hint) {
  const fs = el('fieldset', 'obs-fieldset');
  const legend = el('legend', '', legendText);
  fs.appendChild(legend);
  if (hint) fs.appendChild(el('p', 'subtle', hint));
  return fs;
}

/**
 * Radio (or checkbox) option group built from a [value, label] table.
 * Native inputs keep keyboard, screen-reader and mobile behaviour correct.
 */
function optionGroup({ legend, hint, name, options, value, multiple, onChange }) {
  const fs = fieldset(legend, hint);
  const grid = el('div', 'obs-options');

  for (const [code, label] of options) {
    const input = document.createElement('input');
    input.type = multiple ? 'checkbox' : 'radio';
    input.name = name;
    input.value = code;
    input.id = `obs-${name}-${code}`;
    input.checked = multiple ? Array.isArray(value) && value.includes(code) : value === code;

    const lab = el('label', 'obs-option');
    lab.setAttribute('for', input.id);
    lab.append(input, el('span', '', label));

    input.addEventListener('change', () => {
      if (multiple) {
        const picked = Array.from(grid.querySelectorAll('input:checked')).map((n) => n.value);
        onChange(picked);
      } else if (input.checked) {
        onChange(code);
      }
    });

    grid.appendChild(lab);
  }

  fs.appendChild(grid);
  return fs;
}

/** Look up {code,label} for storing an answer. */
function answerOf(code, options) {
  const found = options.find(([v]) => v === code);
  return { code, label: found ? found[1] : String(code) };
}

/* ---------- Static canvas host ---------- */

/**
 * Mount a static, DPR-correct canvas that paints `draw(renderer, w, h)`.
 * Returns a cleanup function; the caller must run it on step change/exit so no
 * resize listener or ResizeObserver outlives the step.
 */
function staticCanvas({ label, height, settings, draw }) {
  const wrap = el('div', 'obs-canvas');
  const canvas = document.createElement('canvas');
  canvas.className = 'obs-canvas__surface';
  canvas.style.height = `${height}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  canvas.textContent = label;
  wrap.appendChild(canvas);

  const renderer = new AnaglyphRenderer(canvas);
  let disposed = false;
  let queued = false;

  function paint() {
    queued = false;
    if (disposed || !canvas.isConnected) return;
    const cssW = Math.max(1, Math.round(canvas.clientWidth || 320));
    const cssH = Math.max(1, Math.round(canvas.clientHeight || height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    renderer.configure(settings);
    renderer.clear();
    draw(renderer, cssW, cssH);
    renderer.composite();
  }

  function schedule() {
    if (queued || disposed) return;
    queued = true;
    requestAnimationFrame(paint);
  }

  let observer = null;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(schedule);
    observer.observe(canvas);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  schedule();

  const cleanup = () => {
    disposed = true;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
  };

  return { el: wrap, cleanup, canvas };
}

/* ---------- Screen ---------- */

const STEP_KEYS = ['screenCheck', 'targetVisibility', 'fourDot'];
const STEP_TITLES = ['Screen / glasses check', 'Target visibility', 'Four-dot observation'];

function freshScreenCheck() {
  return { skipped: false, completed: false, answers: {} };
}

function freshTargetVisibility() {
  return { skipped: false, completed: false, answers: {} };
}

function freshFourDot() {
  return {
    skipped: false,
    completed: false,
    count: null,
    countCode: '',
    countLabel: '',
    colorCodes: [],
    colorsSeen: [],
    displacement: '',
    displacementLabel: '',
    stability: '',
    stabilityLabel: ''
  };
}

export function mountObservations(root, ctx) {
  const state = {
    mode: 'welcome', // welcome | step | summary
    step: 0,
    startedAt: new Date().toISOString(),
    snapshot: snapshotSettings(ctx.settings),
    screenSide: 'left',
    visibilityEye: 'left',
    screenCheck: freshScreenCheck(),
    targetVisibility: freshTargetVisibility(),
    fourDot: freshFourDot(),
    comment: '',
    saved: false
  };

  const screen = el('main', 'screen');
  const header = el('header', 'stack');
  header.append(el('h1', '', 'Binocular observations'));
  header.append(
    el(
      'p',
      'subtle',
      'Optional guided observations of static images. These are not a screening score, a diagnosis, or a medical assessment.'
    )
  );

  const warning = el('aside', 'banner');
  warning.innerHTML =
    '<strong>Research prototype — not a medical assessment or treatment.</strong> ' +
    'Stop if you notice double vision or discomfort; do not push on through symptoms. ' +
    'New or persistent double vision outside this app needs professional assessment, and sudden new double vision needs prompt care.';

  const liveStatus = el('p', 'visually-hidden');
  liveStatus.setAttribute('role', 'status');
  liveStatus.setAttribute('aria-live', 'polite');
  liveStatus.setAttribute('aria-atomic', 'true');

  const body = el('div', 'stack');

  let stepCleanups = [];

  function clearStep() {
    for (const fn of stepCleanups) {
      try {
        fn();
      } catch (err) {
        console.warn('[observations] step cleanup failed', err);
      }
    }
    stepCleanups = [];
    body.replaceChildren();
  }

  function announce(text) {
    liveStatus.textContent = text;
  }

  /* ---------- Persistence ---------- */

  function persist(outcome) {
    if (state.saved) return null;
    state.saved = true;
    const completedSteps = STEP_KEYS.filter((k) => state[k].completed && !state[k].skipped);
    const record = addObservation({
      kind: 'binocular-observations',
      schemaVersion: OBSERVATION_SCHEMA_VERSION,
      timestamp: state.startedAt,
      outcome,
      completedSteps,
      settings: state.snapshot,
      screenCheck: state.screenCheck,
      targetVisibility: state.targetVisibility,
      fourDot: state.fourDot,
      comment: state.comment
    });
    return record;
  }

  function resetForNewRun() {
    state.mode = 'welcome';
    state.step = 0;
    state.startedAt = new Date().toISOString();
    state.snapshot = snapshotSettings(ctx.settings);
    state.screenSide = 'left';
    state.visibilityEye = 'left';
    state.screenCheck = freshScreenCheck();
    state.targetVisibility = freshTargetVisibility();
    state.fourDot = freshFourDot();
    state.comment = '';
    state.saved = false;
  }

  /* ---------- Shared controls ---------- */

  function nav({ onNext = null, nextLabel = 'Next', canNext = true } = {}) {
    const row = el('div', 'obs-nav');

    const back = el('button', '', 'Back');
    back.type = 'button';
    back.addEventListener('click', () => {
      if (state.mode === 'step' && state.step === 0) {
        state.mode = 'welcome';
        render();
      } else if (state.mode === 'step' && state.step > 0) {
        state.step -= 1;
        render();
      } else {
        ctx.navigate('home');
      }
    });

    const skip = el('button', 'btn--ghost', 'Skip this step');
    skip.type = 'button';
    skip.addEventListener('click', () => {
      const key = STEP_KEYS[state.step];
      state[key].skipped = true;
      state[key].completed = false;
      if (state.step < STEP_KEYS.length - 1) {
        state.step += 1;
        render();
        announce(`Step ${state.step} skipped.`);
      } else {
        persist('completed');
        state.mode = 'summary';
        render();
        announce('Four-dot observation skipped. Observations saved locally.');
      }
    });

    const stop = el('button', 'btn--ghost', 'Stop and exit');
    stop.type = 'button';
    stop.addEventListener('click', () => {
      persist('stopped');
      ctx.navigate('home');
    });

    row.append(back, skip, stop);
    if (onNext) {
      const next = el('button', 'btn--primary', nextLabel);
      next.type = 'button';
      next.disabled = !canNext;
      next.addEventListener('click', onNext);
      row.prepend(next);
    }
    return row;
  }

  /* ---------- Welcome / demonstration ---------- */

  function renderWelcome() {
    const card = el('section', 'card');
    card.append(el('h2', '', 'What this is'));

    const intro = el('p', 'instructions');
    intro.textContent =
      'Three optional steps that help you describe what you actually see through your red/cyan glasses. ' +
      'Everything is static — nothing moves, flashes, or asks you to align anything. ' +
      'You can skip any step, answer “not sure”, or leave at any point. Nothing here changes your calibration or game settings.';
    card.appendChild(intro);

    const demo = staticCanvas({
      label:
        'Demonstration of the image split. Horizontal bars on the left are sent to the left physical eye; block shapes on the right are sent to the right physical eye; the centre line and frame are shared by both eyes.',
      height: 170,
      settings: state.snapshot,
      draw: (r, w, h) => drawSplitDemo(r, w, h)
    });
    stepCleanups.push(demo.cleanup);
    card.appendChild(demo.el);

    const legend = el('dl', 'kv');
    legend.innerHTML = `
      <dt>Bars</dt><dd>left eye only</dd>
      <dt>Blocks</dt><dd>right eye only</dd>
      <dt>Frame and centre line</dt><dd>both eyes</dd>
    `;
    card.appendChild(legend);

    card.appendChild(
      el(
        'p',
        'subtle',
        'Both lenses stay in front of your eyes at all times. When a step says “cover” one eye, cover it with your hand or a card — never try to look through a closed eye.'
      )
    );

    const lens = state.snapshot;
    const facts = el('dl', 'kv');
    facts.innerHTML = `
      <dt>Lens orientation</dt><dd>${lens.lensOrientation === 'LR' ? 'Red right / cyan left' : 'Red left / cyan right'}</dd>
      <dt>Red lens over</dt><dd>${lens.redEye} eye</dd>
      <dt>Cyan lens over</dt><dd>${lens.cyanEye} eye</dd>
      <dt>Declared weaker (amblyopic) eye</dt><dd>${lens.amblyopicEye}</dd>
    `;
    card.appendChild(facts);

    card.appendChild(
      el(
        'p',
        'faint',
        `${getObservations().length} observation record(s) are already stored in this browser. Observations are saved separately from game sessions.`
      )
    );

    const actions = el('div', 'row obs-nav');
    const start = el('button', 'btn--primary', 'Start step 1 of 3');
    start.type = 'button';
    start.addEventListener('click', () => {
      state.mode = 'step';
      state.step = 0;
      render();
    });
    const back = el('button', 'btn--ghost', 'Back to home');
    back.type = 'button';
    back.addEventListener('click', () => ctx.navigate('home'));
    actions.append(start, back);

    card.appendChild(actions);
    body.appendChild(card);
  }

  /* ---------- Step 1: screen / glasses check ---------- */

  function renderScreenCheck() {
    const step = state.screenCheck;
    const side = state.screenSide;
    const physical = side; // the eye the target is intended for
    const covered = side === 'left' ? 'right' : 'left';

    const card = el('section', 'card');
    card.append(el('h2', '', `Step 1 of 3 — ${STEP_TITLES[0]}`));

    card.appendChild(
      el(
        'p',
        'instructions',
        'This is an approximate, subjective check, not a physical calibration. Red/cyan filters always leak some light, so “absent” is rare and small leakage is expected. Each target below is drawn at full intended strength for one eye only (per-eye brightness trim applies; fellow-eye contrast does not).'
      )
    );

    // Explicit target selector: no automatic reversal, no hidden flipping.
    const selector = fieldset('Which target are you checking?');
    const selectorRow = el('div', 'obs-options obs-options--wide');
    for (const option of ['left', 'right']) {
      const id = `obs-target-${option}`;
      const lab = el('label', 'obs-option');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'obs-target-side';
      input.value = option;
      input.id = id;
      input.checked = side === option;
      input.addEventListener('change', () => {
        state.screenSide = option;
        render();
      });
      lab.setAttribute('for', id);
      lab.append(
        input,
        el('span', '', `Target intended for the ${option.toUpperCase()} eye`)
      );
      selectorRow.appendChild(lab);
    }
    selector.appendChild(selectorRow);
    selector.appendChild(
      el(
        'p',
        'faint',
        `Lens reminder: the red lens is over your ${state.snapshot.redEye} eye and the cyan lens over your ${state.snapshot.cyanEye} eye. Check that this matches the glasses on your face; the target is not flipped automatically.`
      )
    );
    card.appendChild(selector);

    // Document exactly what the target is drawn with, so the observation can
    // be interpreted later (values are also saved in the snapshot).
    const snap = state.snapshot;
    const trim = side === 'left' ? snap.leftEyeTrim : snap.rightEyeTrim;
    const lensName = side === snap.redEye ? 'red' : 'cyan';
    const lensColor = lensName === 'red' ? snap.redColor : snap.cyanColor;
    const eff = `rgb(${Math.round(lensColor.r * trim)},${Math.round(lensColor.g * trim)},${Math.round(lensColor.b * trim)})`;
    const values = el('dl', 'kv obs-values');
    values.innerHTML = `
      <dt>Target eye</dt><dd>${physical.toUpperCase()} (${lensName} lens)</dd>
      <dt>Channel colour</dt><dd>rgb(${lensColor.r},${lensColor.g},${lensColor.b})</dd>
      <dt>Eye brightness trim</dt><dd>${Math.round(trim * 100)}%</dd>
      <dt>Drawn at</dt><dd>${eff}</dd>
      <dt>Fellow-eye contrast</dt><dd>not applied to this target</dd>
    `;
    card.appendChild(values);

    const targetLabel = el(
      'p',
      'obs-target-caption',
      `Target intended for the ${physical.toUpperCase()} eye — look through the ${physical} lens`
    );
    const view = staticCanvas({
      label: `Static target intended for the ${physical} physical eye: a hollow ring, a solid inner square, a bar below and two short ticks above.`,
      height: 240,
      settings: state.snapshot,
      draw: (r, w, h) => drawScreenCheckTarget(r, w, h, side === 'left' ? 'leftFull' : 'rightFull')
    });
    stepCleanups.push(view.cleanup);
    card.append(targetLabel, view.el);

    const intendedKey = side === 'left' ? 'leftIntended' : 'rightIntended';
    const leakageKey = side === 'left' ? 'leftLeakage' : 'rightLeakage';
    const intended = step.answers[intendedKey] || {};
    const leakage = step.answers[leakageKey] || {};

    card.appendChild(
      optionGroup({
        legend: 'A. Intended target visibility',
        hint: `Cover your ${covered.toUpperCase()} eye with your hand or a card and KEEP the ${physical.toUpperCase()} eye open. With the ${physical} lens in place, how clearly do you see this target?`,
        name: `screen-intended-${side}`,
        options: SCREEN_OPTIONS,
        value: intended.code,
        onChange: (code) => {
          // Read the current answer live (not the render-time snapshot) so a
          // ghosting choice made first is preserved.
          const live = step.answers[intendedKey] || {};
          step.answers[intendedKey] = { ...answerOf(code, SCREEN_OPTIONS), ...pickGhost(live) };
          announce(`Intended target, ${physical} eye: ${answerOf(code, SCREEN_OPTIONS).label}.`);
        }
      })
    );

    card.appendChild(
      optionGroup({
        legend: 'B. Extra or ghost image (intended target)',
        hint: 'Do you see a second, offset copy of this target? Optional.',
        name: `screen-ghost-${side}`,
        options: GHOST_OPTIONS,
        value: intended.ghostingCode,
        onChange: (code) => {
          const ghost = answerOf(code, GHOST_OPTIONS);
          step.answers[intendedKey] = {
            ...(step.answers[intendedKey] || { code: '', label: '' }),
            ghostingCode: ghost.code,
            ghostingLabel: ghost.label
          };
          announce(`Extra image, ${physical} eye: ${ghost.label}.`);
        }
      })
    );

    card.appendChild(
      optionGroup({
        legend: 'C. Unwanted leakage into the other eye',
        hint: `Now cover your ${physical.toUpperCase()} eye and KEEP the ${covered.toUpperCase()} eye open. Without moving closer or squinting, is any part of this ${physical.toUpperCase()}-intended target visible through the ${covered} lens? This is approximate only.`,
        name: `screen-leakage-${side}`,
        options: SCREEN_OPTIONS,
        value: leakage.code,
        onChange: (code) => {
          step.answers[leakageKey] = answerOf(code, SCREEN_OPTIONS);
          announce(`Leakage into the ${covered} eye: ${answerOf(code, SCREEN_OPTIONS).label}.`);
        }
      })
    );

    const answered = !!(step.answers[intendedKey] || step.answers[leakageKey]);
    if (side === 'left') {
      card.appendChild(
        nav({
          nextLabel: 'Next: target for the RIGHT eye',
          onNext: () => {
            state.screenSide = 'right';
            render();
          }
        })
      );
    } else {
      card.appendChild(
        nav({
          nextLabel: 'Continue to step 2',
          onNext: () => {
            // Only claim the step was "completed" if at least one answer for
            // one of the two targets was actually recorded; otherwise it stays
            // partly/unanswered and the summary says so.
            const anyAnswer = ['leftIntended', 'rightIntended', 'leftLeakage', 'rightLeakage'].some(
              (k) => step.answers[k] && step.answers[k].code
            );
            step.completed = anyAnswer;
            step.skipped = false;
            state.step = 1;
            render();
          }
        })
      );
      card.appendChild(
        el(
          'p',
          'faint',
          answered
            ? 'Answers for both targets are recorded. You can still go Back to change them.'
            : 'You have not recorded any answers. You can go Back, skip the step, or continue — unanswered fields stay empty.'
        )
      );
    }

    body.appendChild(card);
  }

  function pickGhost(answer) {
    return answer && answer.ghostingCode
      ? { ghostingCode: answer.ghostingCode, ghostingLabel: answer.ghostingLabel || '' }
      : {};
  }

  /* ---------- Step 2: target visibility ---------- */

  function renderTargetVisibility() {
    const step = state.targetVisibility;
    const eye = state.visibilityEye;

    const card = el('section', 'card');
    card.append(el('h2', '', `Step 2 of 3 — ${STEP_TITLES[1]}`));

    card.appendChild(
      el(
        'p',
        'instructions',
        'Two static, game-like shapes: a falling piece and a small landed stack. They never move and carry no depth offset. First check each eye on its own, then describe the combined view with both eyes open.'
      )
    );

    // Monocular sample: both shapes are intended for the eye being checked.
    const monocular = staticCanvas({
      label: `Static game-like sample shown to the ${eye} physical eye only: a falling-piece shape and a landed stack shape above a shared ground line.`,
      height: 240,
      settings: state.snapshot,
      draw: (r, w, h) =>
        drawGameTargets(r, w, h, {
          pieceEye: eye === 'left' ? 'leftFull' : 'rightFull',
          stackEye: eye === 'left' ? 'leftFull' : 'rightFull',
          frameEye: eye === 'left' ? 'leftFull' : 'rightFull'
        })
    });
    stepCleanups.push(monocular.cleanup);

    const switchRow = el('div', 'row obs-nav');
    for (const option of ['left', 'right']) {
      const b = el('button', eye === option ? 'btn--selected' : '', `Sample for the ${option.toUpperCase()} eye`);
      b.type = 'button';
      b.setAttribute('aria-pressed', eye === option ? 'true' : 'false');
      b.addEventListener('click', () => {
        state.visibilityEye = option;
        render();
      });
      switchRow.appendChild(b);
    }

    card.append(el('p', 'obs-target-caption', `Sample shown to the ${eye.toUpperCase()} eye only`), monocular.el, switchRow);
    card.appendChild(
      el(
        'p',
        'subtle',
        'Both shapes are intended for the eye you are testing here. Keep the other eye covered with your hand — do not close it and try to see through it.'
      )
    );

    card.appendChild(
      optionGroup({
        legend: 'A. Left eye only',
        hint: 'Cover the right eye and keep the left eye open. How readable are the piece and the stack?',
        name: 'vis-left',
        options: VISIBILITY_OPTIONS,
        value: step.answers.leftEye && step.answers.leftEye.code,
        onChange: (code) => {
          step.answers.leftEye = answerOf(code, VISIBILITY_OPTIONS);
          announce(`Left eye: ${step.answers.leftEye.label}.`);
        }
      })
    );

    card.appendChild(
      optionGroup({
        legend: 'B. Right eye only',
        hint: 'Cover the left eye and keep the right eye open. How readable are the piece and the stack?',
        name: 'vis-right',
        options: VISIBILITY_OPTIONS,
        value: step.answers.rightEye && step.answers.rightEye.code,
        onChange: (code) => {
          step.answers.rightEye = answerOf(code, VISIBILITY_OPTIONS);
          announce(`Right eye: ${step.answers.rightEye.label}.`);
        }
      })
    );

    // Both-eyes-open view: each shape is assigned to one eye on purpose, at
    // full intended strength (per-eye trim only, never fellowContrast), with
    // no disparity and no movement.
    const weaker = state.snapshot.amblyopicEye === 'left' ? 'left' : 'right';
    const other = weaker === 'left' ? 'right' : 'left';
    const both = staticCanvas({
      label: `Static combined sample: the falling-piece shape is sent to the ${weaker} eye and the landed stack to the ${other} eye. The ground line and centre mark are shared by both eyes.`,
      height: 240,
      settings: state.snapshot,
      draw: (r, w, h) =>
        drawGameTargets(r, w, h, {
          pieceEye: weaker === 'left' ? 'leftFull' : 'rightFull',
          stackEye: other === 'left' ? 'leftFull' : 'rightFull',
          frameEye: 'both'
        })
    });
    stepCleanups.push(both.cleanup);

    card.append(el('p', 'obs-target-caption', 'Both eyes open — assigned view'), both.el);
    card.appendChild(
      el(
        'p',
        'subtle',
        `With both eyes open, the piece shape is intentionally sent only to your ${weaker} eye (declared weaker eye) and the stack only to your ${other} eye. Seeing one shape and missing the other is different from a shape being absent by design — use the answers below to describe what you actually saw, and add which shape was missing in the optional comment if you want to record it.`
      )
    );

    card.appendChild(
      optionGroup({
        legend: 'C. Both eyes open',
        hint: 'Remove anything covering either eye. Keep both lenses on. Which description matches what you see?',
        name: 'vis-both',
        options: BOTH_OPEN_OPTIONS,
        value: step.answers.bothOpen && step.answers.bothOpen.code,
        onChange: (code) => {
          step.answers.bothOpen = answerOf(code, BOTH_OPEN_OPTIONS);
          announce(`Both eyes open: ${step.answers.bothOpen.label}.`);
        }
      })
    );

    card.appendChild(
      el(
        'p',
        'instructions',
        'Seeing both shapes does NOT establish binocular fusion, and this step cannot measure suppression or eye alignment.'
      )
    );

    card.appendChild(
      nav({
        nextLabel: 'Continue to step 3',
        onNext: () => {
          const anyAnswer = ['leftEye', 'rightEye', 'bothOpen'].some(
            (k) => step.answers[k] && step.answers[k].code
          );
          step.completed = anyAnswer;
          step.skipped = false;
          state.step = 2;
          render();
        }
      })
    );

    body.appendChild(card);
  }

  /* ---------- Step 3: four-dot observation ---------- */

  function renderFourDot() {
    const four = state.fourDot;

    const card = el('section', 'card');
    card.append(el('h2', '', `Step 3 of 3 — ${STEP_TITLES[2]}`));
    card.appendChild(
      el(
        'p',
        'instructions',
        'This is a generic, unvalidated browser pattern, NOT the Worth 4 Dot test. It produces no diagnosis or classification, and no number of dots is treated as a pass or fail. You may skip it entirely.'
      )
    );

    const demo = staticCanvas({
      label:
        'Demonstration of the four-dot pattern: four static circles in a square arrangement inside a shared frame, all drawn to both eyes so the layout can be seen before any channel assignment.',
      height: 200,
      settings: state.snapshot,
      draw: (r, w, h) => drawFourDotPattern(r, w, h, 'demo')
    });
    stepCleanups.push(demo.cleanup);

    const demoCaption = el('p', 'obs-target-caption', 'Demonstration — layout only, all dots shown to both eyes');
    card.append(demoCaption, demo.el);

    const legend = el('section', 'obs-note');
    legend.append(el('h3', '', 'How the four dots are assigned'));
    const list = document.createElement('ul');
    list.className = 'instructions';
    for (const item of FOUR_DOT_ASSIGNMENT) {
      list.appendChild(el('li', '', `${item.position}: ${item.text}.`));
    }
    legend.appendChild(list);
    legend.appendChild(
      el(
        'p',
        'subtle',
        'The top dot is shared by both eyes, so it can look different from the others. Leakage between lenses and any ghosting can make the count ambiguous — that is a limitation of this pattern, not a result.'
      )
    );
    card.appendChild(legend);

    const sample = staticCanvas({
      label:
        'Static four-dot observation pattern: shared frame, one shared top dot drawn to both eyes, two left-channel dots and one right-channel dot.',
      height: 200,
      settings: state.snapshot,
      draw: (r, w, h) => drawFourDotPattern(r, w, h, 'observe')
    });
    stepCleanups.push(sample.cleanup);
    card.append(el('p', 'obs-target-caption', 'Observation pattern — assigned channels'), sample.el);

    card.appendChild(
      optionGroup({
        legend: 'A. Number of dots you observe',
        hint: 'Count what you actually see, including any extra dots. Do not aim for an expected number.',
        name: 'four-count',
        options: COUNT_OPTIONS,
        value: four.countCode,
        onChange: (code) => {
          const a = answerOf(code, COUNT_OPTIONS);
          four.countCode = code;
          four.countLabel = a.label;
          four.count =
            code === 'unsure' || code === 'cannot' ? null : code === '5plus' ? 5 : Number(code);
          announce(`Dots observed: ${a.label}.`);
        }
      })
    );

    card.appendChild(
      optionGroup({
        legend: 'B. Colours you see',
        hint: 'Select every colour that appears. Mixed or uncertain answers are fine.',
        name: 'four-colour',
        options: COLOUR_OPTIONS,
        multiple: true,
        value: four.colorCodes,
        onChange: (codes) => {
          four.colorCodes = codes;
          four.colorsSeen = codes.map((c) => answerOf(c, COLOUR_OPTIONS).label);
          announce(`Colours recorded: ${four.colorsSeen.join(', ') || 'none'}.`);
        }
      })
    );

    card.appendChild(
      optionGroup({
        legend: 'C. Displacement between dots',
        hint: 'Do any dots appear separated or shifted rather than in one clean square?',
        name: 'four-displacement',
        options: DISPLACEMENT_OPTIONS,
        value: four.displacement,
        onChange: (code) => {
          four.displacement = code;
          four.displacementLabel = answerOf(code, DISPLACEMENT_OPTIONS).label;
          announce(`Displacement: ${four.displacementLabel}.`);
        }
      })
    );

    card.appendChild(
      optionGroup({
        legend: 'D. Appearance over time',
        hint: 'While you keep looking, does the pattern stay put or change?',
        name: 'four-stability',
        options: STABILITY_OPTIONS,
        value: four.stability,
        onChange: (code) => {
          four.stability = code;
          four.stabilityLabel = answerOf(code, STABILITY_OPTIONS).label;
          announce(`Stability: ${four.stabilityLabel}.`);
        }
      })
    );

    const commentField = el('div', 'field');
    const commentLabel = document.createElement('label');
    commentLabel.setAttribute('for', 'obs-comment');
    commentLabel.className = 'field__label';
    commentLabel.append(el('span', '', 'Optional comment'));
    const commentNote = el('span', 'faint', 'Avoid names or personal information');
    commentLabel.appendChild(commentNote);
    const comment = document.createElement('textarea');
    comment.id = 'obs-comment';
    comment.rows = 3;
    comment.maxLength = 1000;
    comment.value = state.comment;
    comment.setAttribute('aria-describedby', 'obs-comment-help');
    comment.addEventListener('input', () => {
      state.comment = comment.value;
    });
    const help = el(
      'p',
      'faint',
      'Please avoid names or personal information. Stored only in this browser; included in your exports.'
    );
    help.id = 'obs-comment-help';
    commentField.append(commentLabel, comment, help);
    card.appendChild(commentField);

    card.appendChild(
      nav({
        nextLabel: 'Save observations',
        onNext: () => {
          // "Cannot do this" and "Not sure" are legitimate answers; only an
          // entirely untouched step is recorded as unanswered.
          four.completed = !!(
            four.countCode ||
            four.colorsSeen.length ||
            four.displacement ||
            four.stability
          );
          four.skipped = false;
          persist('completed');
          state.mode = 'summary';
          render();
          announce('Observations saved locally.');
        }
      })
    );

    body.appendChild(card);
  }

  /* ---------- Summary ---------- */

  function describeStep(step) {
    if (step.skipped) return 'skipped';
    if (step.completed) return 'recorded';
    // The four-dot step stores flat fields rather than an `answers` map.
    const count = step.answers ? Object.keys(step.answers).length : 0;
    return count ? `partly answered (${count})` : 'not answered';
  }

  function renderSummary() {
    const card = el('section', 'card');
    card.append(el('h2', '', 'Observation summary'));

    card.appendChild(
      el(
        'p',
        'instructions',
        'These are self-reported observations from a research prototype. They are not a score, a diagnosis, or a measurement of eye alignment, and seeing both targets does not establish fusion. If a recorded observation is saved, you can export it from the log.'
      )
    );

    const kv = el('dl', 'kv');
    const rows = [
      ['Screen / glasses check', describeStep(state.screenCheck)],
      ['Target visibility', describeStep(state.targetVisibility)],
      ['Four-dot observation', describeStep(state.fourDot)],
      ['Recorded at', new Date(state.startedAt).toLocaleString()]
    ];
    for (const [k, v] of rows) {
      kv.append(el('dt', '', k), el('dd', '', v));
    }
    card.appendChild(kv);

    const details = [];
    for (const [key, label] of Object.entries({
      leftIntended: 'Left target — intended visibility',
      leftLeakage: 'Left target — leakage into right eye',
      rightIntended: 'Right target — intended visibility',
      rightLeakage: 'Right target — leakage into left eye'
    })) {
      const a = state.screenCheck.answers[key];
      if (!a || !a.label) continue;
      details.push([label, a.label + (a.ghostingLabel ? ` · ${a.ghostingLabel}` : '')]);
    }
    for (const [key, label] of Object.entries({
      leftEye: 'Left eye only',
      rightEye: 'Right eye only',
      bothOpen: 'Both eyes open'
    })) {
      const a = state.targetVisibility.answers[key];
      if (a && a.label) details.push([label, a.label]);
    }
    if (state.fourDot.countLabel) details.push(['Dots observed', state.fourDot.countLabel]);
    if (state.fourDot.colorsSeen.length) {
      details.push(['Colours observed', state.fourDot.colorsSeen.join(', ')]);
    }
    if (state.fourDot.displacementLabel) {
      details.push(['Displacement', state.fourDot.displacementLabel]);
    }
    if (state.fourDot.stabilityLabel) {
      details.push(['Stability', state.fourDot.stabilityLabel]);
    }

    if (details.length) {
      const dl = el('dl', 'kv');
      for (const [k, v] of details) dl.append(el('dt', '', k), el('dd', '', v));
      card.appendChild(dl);
    }

    if (state.comment) {
      const note = el('section', 'obs-note');
      note.append(el('h3', '', 'Your comment'));
      note.append(el('p', 'instructions', state.comment));
      card.appendChild(note);
    }

    card.appendChild(
      el(
        'p',
        'faint',
        'Stored locally in this browser only, in a separate record from game sessions. The lens, colour, trim, display and distance settings active during this observation are saved with it.'
      )
    );

    const actions = el('div', 'stack');
    const again = el('button', 'btn--primary', 'Run observations again');
    again.type = 'button';
    again.addEventListener('click', () => {
      resetForNewRun();
      render();
    });

    const log = el('button', '', 'Observation history and exports');
    log.type = 'button';
    log.addEventListener('click', () => ctx.navigate('log'));

    const home = el('button', 'btn--ghost', 'Back to home');
    home.type = 'button';
    home.addEventListener('click', () => ctx.navigate('home'));

    actions.append(again, log, home);
    card.appendChild(actions);
    body.appendChild(card);
  }

  /* ---------- Router ---------- */

  function render() {
    clearStep();
    if (state.mode === 'welcome') renderWelcome();
    else if (state.mode === 'summary') renderSummary();
    else if (state.step === 0) renderScreenCheck();
    else if (state.step === 1) renderTargetVisibility();
    else renderFourDot();
  }

  screen.append(header, warning, body, liveStatus);
  root.appendChild(screen);
  render();

  return () => {
    clearStep();
    // Leaving mid-flow keeps whatever was answered, flagged as stopped, so a
    // half-finished observation is never lost. The welcome screen alone does
    // not create a record.
    if (!state.saved && state.mode !== 'welcome') persist('stopped');
    screen.remove();
  };
}

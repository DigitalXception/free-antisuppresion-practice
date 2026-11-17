/*!
 * store.js — localStorage persistence for settings and session log.
 * All keys are namespaced with "antisup_".
 */

const PREFIX = 'antisup_';
const KEY_SETTINGS = PREFIX + 'settings';
const KEY_SESSIONS = PREFIX + 'sessions';
// Guided binocular observations live in their own key on purpose: they are
// self-reported observations, not gameplay results, and must stay separable in
// exports and when clearing data.
const KEY_OBSERVATIONS = PREFIX + 'observations';

/** Schema version for stored observation records (see observations.js). */
export const OBSERVATION_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  lensOrientation: 'RL', // 'RL' = red lens on left eye, cyan on right | 'LR' = red on right
  amblyopicEye: 'right', // 'left' | 'right' | 'equal'
  fellowContrast: 0.20,  // 0.05 .. 1.0
  redColor: { r: 255, g: 0, b: 0 },
  cyanColor: { r: 0, g: 255, b: 255 },
  leftEyeTrim: 1.0,
  rightEyeTrim: 1.0,
  screenMmPerPx: null,
  screenMethod: 'guessed', // 'guessed' | 'card'
  viewingDistanceCm: 60,
  sessionLengthMin: 60
});

function safeParse(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch (err) {
    return null;
  }
}

function cloneSettings(s) {
  return {
    lensOrientation: s.lensOrientation,
    amblyopicEye: s.amblyopicEye,
    fellowContrast: s.fellowContrast,
    redColor: { r: s.redColor.r, g: s.redColor.g, b: s.redColor.b },
    cyanColor: { r: s.cyanColor.r, g: s.cyanColor.g, b: s.cyanColor.b },
    leftEyeTrim: s.leftEyeTrim,
    rightEyeTrim: s.rightEyeTrim,
    screenMmPerPx: s.screenMmPerPx,
    screenMethod: s.screenMethod,
    viewingDistanceCm: s.viewingDistanceCm,
    sessionLengthMin: s.sessionLengthMin
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, fallback) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const int255 = (v, fallback) => Math.round(clamp(num(v, fallback), 0, 255));

/** Merge a partial/possibly-corrupt object onto defaults, coercing types. */
export function normalizeSettings(input) {
  const d = DEFAULT_SETTINGS;
  const s = input && typeof input === 'object' ? input : {};
  const red = s.redColor && typeof s.redColor === 'object' ? s.redColor : {};
  const cyan = s.cyanColor && typeof s.cyanColor === 'object' ? s.cyanColor : {};
  const mm = num(s.screenMmPerPx, NaN);

  return {
    lensOrientation: s.lensOrientation === 'LR' ? 'LR' : 'RL',
    amblyopicEye:
      s.amblyopicEye === 'left' || s.amblyopicEye === 'right' || s.amblyopicEye === 'equal'
        ? s.amblyopicEye
        : d.amblyopicEye,
    fellowContrast: clamp(num(s.fellowContrast, d.fellowContrast), 0.05, 1.0),
    redColor: {
      r: int255(red.r, d.redColor.r),
      g: int255(red.g, d.redColor.g),
      b: int255(red.b, d.redColor.b)
    },
    cyanColor: {
      r: int255(cyan.r, d.cyanColor.r),
      g: int255(cyan.g, d.cyanColor.g),
      b: int255(cyan.b, d.cyanColor.b)
    },
    leftEyeTrim: clamp(num(s.leftEyeTrim, d.leftEyeTrim), 0.3, 1.0),
    rightEyeTrim: clamp(num(s.rightEyeTrim, d.rightEyeTrim), 0.3, 1.0),
    screenMmPerPx: Number.isFinite(mm) && mm > 0 ? mm : null,
    screenMethod: s.screenMethod === 'card' ? 'card' : 'guessed',
    viewingDistanceCm: clamp(num(s.viewingDistanceCm, d.viewingDistanceCm), 20, 300),
    sessionLengthMin: Math.round(clamp(num(s.sessionLengthMin, d.sessionLengthMin), 5, 60))
  };
}

export function getSettings() {
  const raw = safeParse(localStorage.getItem(KEY_SETTINGS));
  return normalizeSettings(raw);
}

export function saveSettings(obj) {
  const current = getSettings();
  const patch = obj && typeof obj === 'object' ? obj : {};
  // Deep-merge the two colour objects so partial patches keep the other channels.
  const merged = {
    ...current,
    ...patch,
    redColor: { ...current.redColor, ...(patch.redColor || {}) },
    cyanColor: { ...current.cyanColor, ...(patch.cyanColor || {}) }
  };
  const normalized = normalizeSettings(merged);
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(normalized));
  } catch (err) {
    console.warn('[store] could not persist settings', err);
  }
  return normalized;
}

/** Patch a single field and persist. Convenience helper. */
export function patchSettings(patch) {
  return saveSettings(patch);
}

export function getSessions() {
  const raw = safeParse(localStorage.getItem(KEY_SESSIONS));
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.sessions) ? raw.sessions : [];
  return arr.filter((e) => e && typeof e === 'object');
}

export function addSession(entry) {
  const sessions = getSessions();
  const record = {
    id: (entry && entry.id) || 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    timestamp: (entry && entry.timestamp) || new Date().toISOString(),
    game: (entry && entry.game) || 'unknown',
    durationSec: Math.max(0, Math.round(num(entry && entry.durationSec, 0))),
    score: Math.max(0, Math.round(num(entry && entry.score, 0))),
    level: Math.max(0, Math.round(num(entry && entry.level, 0))),
    lines: Math.max(0, Math.round(num(entry && entry.lines, 0))),
    fellowContrast: clamp(num(entry && entry.fellowContrast, DEFAULT_SETTINGS.fellowContrast), 0, 1),
    amblyopicEye: (entry && entry.amblyopicEye) || DEFAULT_SETTINGS.amblyopicEye,
    lensOrientation: (entry && entry.lensOrientation) || DEFAULT_SETTINGS.lensOrientation,
    screenMethod: (entry && entry.screenMethod) || DEFAULT_SETTINGS.screenMethod,
    notes: (entry && entry.notes) || ''
  };
  sessions.push(record);
  // Keep the log bounded so localStorage cannot blow up.
  const trimmed = sessions.slice(-500);
  try {
    localStorage.setItem(KEY_SESSIONS, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[store] could not persist session', err);
  }
  return record;
}

export function clearSessions() {
  try {
    localStorage.removeItem(KEY_SESSIONS);
  } catch (err) {
    console.warn('[store] could not clear sessions', err);
  }
}

/* ---------- Binocular observations ---------- */

const OBS_MAX = 200;

/**
 * Immutable snapshot of every setting that influences what was on screen.
 * Colours are copied by value so later calibration edits never rewrite an
 * already-saved observation. No participant identifiers are stored.
 */
export function snapshotSettings(input) {
  const s = normalizeSettings(input || getSettings());
  return {
    lensOrientation: s.lensOrientation,
    redEye: s.lensOrientation === 'LR' ? 'right' : 'left',
    cyanEye: s.lensOrientation === 'LR' ? 'left' : 'right',
    amblyopicEye: s.amblyopicEye,
    fellowContrast: s.fellowContrast,
    redColor: { r: s.redColor.r, g: s.redColor.g, b: s.redColor.b },
    cyanColor: { r: s.cyanColor.r, g: s.cyanColor.g, b: s.cyanColor.b },
    leftEyeTrim: s.leftEyeTrim,
    rightEyeTrim: s.rightEyeTrim,
    screenMmPerPx: s.screenMmPerPx,
    screenMethod: s.screenMethod,
    viewingDistanceCm: s.viewingDistanceCm
  };
}

const safeStr = (v, max) => {
  if (v == null) return '';
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
};

/** Coerce one stored observation into a predictable shape (forward/back compatible). */
function normalizeObservation(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const settings = o.settings && typeof o.settings === 'object' ? o.settings : {};
  const red = settings.redColor && typeof settings.redColor === 'object' ? settings.redColor : {};
  const cyan = settings.cyanColor && typeof settings.cyanColor === 'object' ? settings.cyanColor : {};
  const completed = Array.isArray(o.completedSteps)
    ? o.completedSteps.filter((s) => typeof s === 'string')
    : [];
  const fourDot = o.fourDot && typeof o.fourDot === 'object' ? o.fourDot : {};
  const colors = Array.isArray(fourDot.colorsSeen)
    ? fourDot.colorsSeen.filter((c) => typeof c === 'string')
    : [];
  const mm = num(settings.screenMmPerPx, NaN);

  return {
    id: safeStr(o.id, 64) || 'obs_legacy',
    kind: 'binocular-observations',
    schemaVersion: Number.isFinite(o.schemaVersion) ? o.schemaVersion : 1,
    timestamp: safeStr(o.timestamp, 40),
    outcome: o.outcome === 'completed' || o.outcome === 'stopped' ? o.outcome : 'stopped',
    completedSteps: completed,
    settings: {
      lensOrientation: settings.lensOrientation === 'LR' ? 'LR' : 'RL',
      redEye: settings.redEye === 'right' ? 'right' : 'left',
      cyanEye: settings.cyanEye === 'right' ? 'right' : 'left',
      amblyopicEye:
        settings.amblyopicEye === 'left' ||
        settings.amblyopicEye === 'right' ||
        settings.amblyopicEye === 'equal'
          ? settings.amblyopicEye
          : 'right',
      fellowContrast: clamp(num(settings.fellowContrast, DEFAULT_SETTINGS.fellowContrast), 0, 1),
      redColor: {
        r: int255(red.r, DEFAULT_SETTINGS.redColor.r),
        g: int255(red.g, DEFAULT_SETTINGS.redColor.g),
        b: int255(red.b, DEFAULT_SETTINGS.redColor.b)
      },
      cyanColor: {
        r: int255(cyan.r, DEFAULT_SETTINGS.cyanColor.r),
        g: int255(cyan.g, DEFAULT_SETTINGS.cyanColor.g),
        b: int255(cyan.b, DEFAULT_SETTINGS.cyanColor.b)
      },
      leftEyeTrim: clamp(num(settings.leftEyeTrim, DEFAULT_SETTINGS.leftEyeTrim), 0.3, 1),
      rightEyeTrim: clamp(num(settings.rightEyeTrim, DEFAULT_SETTINGS.rightEyeTrim), 0.3, 1),
      screenMmPerPx: Number.isFinite(mm) && mm > 0 ? mm : null,
      screenMethod: settings.screenMethod === 'card' ? 'card' : 'guessed',
      viewingDistanceCm: clamp(
        num(settings.viewingDistanceCm, DEFAULT_SETTINGS.viewingDistanceCm),
        20,
        300
      )
    },
    screenCheck: normalizeStep(o.screenCheck),
    targetVisibility: normalizeStep(o.targetVisibility),
    fourDot: {
      skipped: !!fourDot.skipped,
      completed: !!fourDot.completed,
      count: Number.isFinite(num(fourDot.count, NaN)) ? Math.round(num(fourDot.count, 0)) : null,
      countLabel: safeStr(fourDot.countLabel, 40),
      colorsSeen: colors.slice(0, 12).map((c) => safeStr(c, 40)),
      displacement: safeStr(fourDot.displacement, 40),
      displacementLabel: safeStr(fourDot.displacementLabel, 120),
      stability: safeStr(fourDot.stability, 40),
      stabilityLabel: safeStr(fourDot.stabilityLabel, 120)
    },
    comment: safeStr(o.comment, 1000)
  };
}

/** Steps are stored as { skipped, completed, answers: { key: {...} } }. */
function normalizeStep(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const answersIn = s.answers && typeof s.answers === 'object' ? s.answers : {};
  const answers = {};
  for (const key of Object.keys(answersIn)) {
    const a = answersIn[key];
    if (!a || typeof a !== 'object') continue;
    // Only scalar fields survive: keeps the record flat, bounded and safe to
    // read back into a form, while allowing new answer fields to be added
    // without a storage migration.
    const out = {};
    for (const field of Object.keys(a)) {
      const v = a[field];
      if (typeof v === 'string') out[field] = safeStr(v, 160);
      else if (typeof v === 'number' && Number.isFinite(v)) out[field] = v;
      else if (typeof v === 'boolean') out[field] = v;
    }
    answers[safeStr(key, 60)] = out;
  }
  return { skipped: !!s.skipped, completed: !!s.completed, answers };
}

export function getObservations() {
  const raw = safeParse(localStorage.getItem(KEY_OBSERVATIONS));
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.observations) ? raw.observations : [];
  return arr.filter((e) => e && typeof e === 'object').map(normalizeObservation);
}

export function addObservation(entry) {
  const observations = getObservations();
  const record = normalizeObservation({
    ...(entry || {}),
    id:
      (entry && entry.id) ||
      'obs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    timestamp: (entry && entry.timestamp) || new Date().toISOString(),
    schemaVersion: OBSERVATION_SCHEMA_VERSION
  });
  observations.push(record);
  const trimmed = observations.slice(-OBS_MAX);
  try {
    localStorage.setItem(KEY_OBSERVATIONS, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[store] could not persist observation', err);
  }
  return record;
}

export function clearObservations() {
  try {
    localStorage.removeItem(KEY_OBSERVATIONS);
  } catch (err) {
    console.warn('[store] could not clear observations', err);
  }
}

export function hasObservations() {
  return getObservations().length > 0;
}

/* ---------- Export helpers ---------- */

function download(filename, mime, text) {
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function exportJSON() {
  const payload = {
    app: 'anti-suppression-practice',
    // 2 = adds an `observations` section. `sessions` and `settings` keep the
    // exact shape they had in version 1, so older readers still work.
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    sessions: getSessions(),
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    observations: getObservations()
  };
  download(`antisup-sessions-${stamp()}.json`, 'application/json', JSON.stringify(payload, null, 2));
}

/**
 * CSV cell escaping. Text that starts with a spreadsheet formula character is
 * prefixed with an apostrophe so opening the file never executes it.
 * Applied to every cell (numeric-looking game values are unaffected because
 * the guard only fires for string input starting with = + - @ tab or CR).
 */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function exportCSV() {
  const sessions = getSessions();
  const header = [
    'timestamp',
    'game',
    'durationSec',
    'score',
    'level',
    'lines',
    'fellowContrast',
    'amblyopicEye',
    'lensOrientation',
    'screenMethod'
  ];
  const rows = [header.join(',')];
  for (const s of sessions) {
    rows.push(
      [
        s.timestamp || '',
        s.game || '',
        Math.round(num(s.durationSec, 0)),
        Math.round(num(s.score, 0)),
        Math.round(num(s.level, 0)),
        Math.round(num(s.lines, 0)),
        num(s.fellowContrast, ''),
        s.amblyopicEye || '',
        s.lensOrientation || '',
        s.screenMethod || ''
      ]
        .map(csvCell)
        .join(',')
    );
  }
  download(`antisup-sessions-${stamp()}.csv`, 'text/csv', rows.join('\r\n'));
}

/* ---------- Observation exports (separate from gameplay sessions) ---------- */

/** Flatten one observation into the columns used by the observation CSV. */
function observationRow(o) {
  const s = o.settings;
  const sc = o.screenCheck.answers;
  const tv = o.targetVisibility.answers;
  const label = (answers, key) => (answers[key] && answers[key].label) || '';
  const ghost = (answers, key) => (answers[key] && answers[key].ghostingLabel) || '';

  return [
    o.timestamp,
    o.outcome,
    o.completedSteps.join(' '),
    o.schemaVersion,
    s.lensOrientation,
    s.redEye,
    s.cyanEye,
    s.amblyopicEye,
    s.fellowContrast,
    `rgb(${s.redColor.r},${s.redColor.g},${s.redColor.b})`,
    `rgb(${s.cyanColor.r},${s.cyanColor.g},${s.cyanColor.b})`,
    s.leftEyeTrim,
    s.rightEyeTrim,
    s.screenMmPerPx == null ? '' : s.screenMmPerPx,
    s.screenMethod,
    s.viewingDistanceCm,
    o.screenCheck.skipped ? 'skipped' : o.screenCheck.completed ? 'answered' : 'unanswered',
    label(sc, 'leftIntended'),
    ghost(sc, 'leftIntended'),
    label(sc, 'leftLeakage'),
    label(sc, 'rightIntended'),
    ghost(sc, 'rightIntended'),
    label(sc, 'rightLeakage'),
    o.targetVisibility.skipped
      ? 'skipped'
      : o.targetVisibility.completed
        ? 'answered'
        : 'unanswered',
    label(tv, 'leftEye'),
    label(tv, 'rightEye'),
    label(tv, 'bothOpen'),
    o.fourDot.skipped ? 'skipped' : o.fourDot.completed ? 'answered' : 'unanswered',
    o.fourDot.countLabel,
    o.fourDot.colorsSeen.join(' '),
    o.fourDot.displacementLabel,
    o.fourDot.stabilityLabel,
    o.comment
  ];
}

const OBSERVATION_CSV_HEADER = [
  'timestamp',
  'outcome',
  'completedSteps',
  'schemaVersion',
  'lensOrientation',
  'redLensEye',
  'cyanLensEye',
  'amblyopicEye',
  'fellowContrast',
  'redColor',
  'cyanColor',
  'leftEyeTrim',
  'rightEyeTrim',
  'screenMmPerPx',
  'screenMethod',
  'viewingDistanceCm',
  'screenCheckStatus',
  'targetLeftIntended',
  'targetLeftIntendedGhosting',
  'targetLeftLeakage',
  'targetRightIntended',
  'targetRightIntendedGhosting',
  'targetRightLeakage',
  'targetVisibilityStatus',
  'leftEyeOnly',
  'rightEyeOnly',
  'bothEyesOpen',
  'fourDotStatus',
  'fourDotCount',
  'fourDotColorsSeen',
  'fourDotDisplacement',
  'fourDotStability',
  'comment'
];

export function exportObservationsJSON() {
  const payload = {
    app: 'anti-suppression-practice',
    section: 'binocular-observations',
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    note: 'Self-reported observations from a research prototype. Not a clinical assessment.',
    settingsSnapshotPolicy:
      'Each observation stores the display/lens/colour settings that were active when it was recorded.',
    observations: getObservations()
  };
  download(
    `antisup-observations-${stamp()}.json`,
    'application/json',
    JSON.stringify(payload, null, 2)
  );
}

export function exportObservationsCSV() {
  const observations = getObservations();
  const rows = [OBSERVATION_CSV_HEADER.join(',')];
  for (const o of observations) {
    rows.push(observationRow(o).map(csvCell).join(','));
  }
  download(`antisup-observations-${stamp()}.csv`, 'text/csv', rows.join('\r\n'));
}

/** Convenience for UI: is there anything worth exporting? */
export function hasSessions() {
  return getSessions().length > 0;
}

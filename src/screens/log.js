/*!
 * log.js — session log + separate binocular-observation history, with their
 * own JSON / CSV exports.
 *
 * The two data sets are deliberately kept apart:
 *   - gameplay sessions    (antisup_sessions)
 *   - self-reported observations (antisup_observations)
 * Clearing one never clears the other, and each has its own export buttons.
 * The combined "Export JSON/CSV" buttons keep the previous behaviour for
 * sessions, and the JSON export additionally carries an `observations` section.
 */

import {
  getSessions,
  getObservations,
  exportJSON,
  exportCSV,
  exportObservationsJSON,
  exportObservationsCSV,
  clearSessions,
  clearObservations
} from '../store.js';

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || '—');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function eyeLabel(e) {
  if (e === 'left') return 'Left';
  if (e === 'right') return 'Right';
  if (e === 'equal') return 'Equal';
  return e || '—';
}

function rerender() {
  window.dispatchEvent(new Event('hashchange'));
}

/* ---------- Observation rendering helpers ---------- */

const ANSWER_LABELS = {
  leftIntended: 'Left target — intended',
  leftLeakage: 'Left target — leakage',
  rightIntended: 'Right target — intended',
  rightLeakage: 'Right target — leakage',
  leftEye: 'Left eye only',
  rightEye: 'Right eye only',
  bothOpen: 'Both eyes open'
};

function summarizeObservation(o) {
  const parts = [];
  const sc = o.screenCheck;
  const tv = o.targetVisibility;

  if (sc.skipped) parts.push('screen check skipped');
  else if (sc.completed) parts.push('screen check recorded');
  if (tv.skipped) parts.push('visibility skipped');
  else if (tv.completed) parts.push('visibility recorded');
  if (o.fourDot.skipped) parts.push('four-dot skipped');
  else if (o.fourDot.completed) {
    parts.push(`four-dot: ${o.fourDot.countLabel || 'no count'}`);
  }
  return parts.length ? parts.join(' · ') : 'no answers recorded';
}

/** Build a bulleted list of the answers that were actually given. */
function observationDetails(o, list) {
  const answers = [];
  for (const step of [o.screenCheck, o.targetVisibility]) {
    for (const [key, answer] of Object.entries(step.answers)) {
      if (!answer || !answer.label) continue;
      const ghost = answer.ghostingLabel ? ` (${answer.ghostingLabel})` : '';
      answers.push(`${ANSWER_LABELS[key] || key}: ${answer.label}${ghost}`);
    }
  }
  const four = o.fourDot;
  if (four.countLabel) answers.push(`Dots observed: ${four.countLabel}`);
  if (four.colorsSeen.length) answers.push(`Colours: ${four.colorsSeen.join(', ')}`);
  if (four.displacementLabel) answers.push(`Displacement: ${four.displacementLabel}`);
  if (four.stabilityLabel) answers.push(`Stability: ${four.stabilityLabel}`);
  if (o.comment) answers.push(`Comment: ${o.comment}`);

  for (const text of answers) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }
}

export function mountLog(root) {
  const screen = document.createElement('div');
  screen.className = 'screen';

  const header = document.createElement('div');
  header.className = 'stack';
  header.innerHTML = `
    <h1>Log and exports</h1>
    <p class="subtle">Everything is stored locally in this browser only. Nothing is uploaded.</p>
  `;

  const sessions = getSessions()
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const observations = getObservations()
    .slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

  /* ---------- Sessions ---------- */

  const sessionHeading = document.createElement('h2');
  sessionHeading.textContent = 'Game sessions';

  const stats = document.createElement('div');
  stats.className = 'card';
  if (sessions.length) {
    const totalSec = sessions.reduce((acc, s) => acc + (Number(s.durationSec) || 0), 0);
    const best = sessions.reduce((acc, s) => Math.max(acc, Number(s.score) || 0), 0);
    stats.innerHTML = `
      <h2>Summary</h2>
      <dl class="kv">
        <dt>Sessions</dt><dd>${sessions.length}</dd>
        <dt>Total time</dt><dd>${fmtDuration(totalSec)}</dd>
        <dt>Best score</dt><dd>${best}</dd>
      </dl>
    `;
  } else {
    stats.innerHTML = `
      <h2>No game sessions yet</h2>
      <p class="subtle" style="margin:0">Finish a game session and it will appear here.</p>
    `;
  }

  const actions = document.createElement('div');
  actions.className = 'btn-grid btn-grid--2';

  const jsonBtn = document.createElement('button');
  jsonBtn.textContent = 'Export sessions JSON';
  jsonBtn.disabled = sessions.length === 0 && observations.length === 0;
  jsonBtn.addEventListener('click', () => exportJSON());

  const csvBtn = document.createElement('button');
  csvBtn.textContent = 'Export sessions CSV';
  csvBtn.disabled = sessions.length === 0;
  csvBtn.addEventListener('click', () => exportCSV());

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn--danger';
  clearBtn.textContent = 'Clear game sessions';
  clearBtn.disabled = sessions.length === 0;
  clearBtn.addEventListener('click', () => {
    if (!confirm(`Delete all ${sessions.length} saved session(s)? This cannot be undone.`)) return;
    clearSessions();
    rerender();
  });

  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => {
    location.hash = '#home';
  });

  actions.append(jsonBtn, csvBtn, clearBtn, backBtn);

  screen.append(header, sessionHeading, stats, actions);

  if (sessions.length) {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th scope="col">Date</th>
        <th scope="col">Game</th>
        <th scope="col" class="num">Duration</th>
        <th scope="col" class="num">Score</th>
        <th scope="col" class="num">Fellow Contrast</th>
        <th scope="col">Eye</th>
      </tr>
    `;

    const tbody = document.createElement('tbody');
    for (const s of sessions) {
      const tr = document.createElement('tr');

      const cells = [
        fmtDate(s.timestamp),
        s.game || '—',
        fmtDuration(s.durationSec),
        String(s.score ?? '—'),
        Number.isFinite(Number(s.fellowContrast))
          ? Math.round(Number(s.fellowContrast) * 100) + '%'
          : '—',
        eyeLabel(s.amblyopicEye)
      ];

      for (let i = 0; i < cells.length; i++) {
        const td = document.createElement('td');
        td.textContent = cells[i];
        if (i === 2 || i === 3 || i === 4) td.className = 'num';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.append(thead, tbody);
    wrap.appendChild(table);
    screen.appendChild(wrap);
  }

  /* ---------- Observations (separate section) ---------- */

  const obsHeading = document.createElement('h2');
  obsHeading.textContent = 'Binocular observations';

  const obsIntro = document.createElement('p');
  obsIntro.className = 'subtle';
  obsIntro.textContent =
    'Self-reported observations from the guided flow. Not a score, diagnosis, or measure of eye alignment. Stored separately from game sessions.';

  const obsActions = document.createElement('div');
  obsActions.className = 'btn-grid btn-grid--2';

  const obsJson = document.createElement('button');
  obsJson.textContent = 'Export observations JSON';
  obsJson.disabled = observations.length === 0;
  obsJson.addEventListener('click', () => exportObservationsJSON());

  const obsCsv = document.createElement('button');
  obsCsv.textContent = 'Export observations CSV';
  obsCsv.disabled = observations.length === 0;
  obsCsv.addEventListener('click', () => exportObservationsCSV());

  const obsNew = document.createElement('button');
  obsNew.textContent = 'New observation';
  obsNew.addEventListener('click', () => {
    location.hash = '#observations';
  });

  const obsClear = document.createElement('button');
  obsClear.className = 'btn--danger';
  obsClear.textContent = 'Clear observations';
  obsClear.disabled = observations.length === 0;
  obsClear.addEventListener('click', () => {
    if (!confirm(`Delete all ${observations.length} saved observation(s)? Game sessions are kept.`)) return;
    clearObservations();
    rerender();
  });

  obsActions.append(obsJson, obsCsv, obsNew, obsClear);
  screen.append(obsHeading, obsIntro, obsActions);

  if (!observations.length) {
    const empty = document.createElement('p');
    empty.className = 'faint';
    empty.textContent = 'No observations saved yet.';
    screen.appendChild(empty);
  } else {
    const obsList = document.createElement('div');
    obsList.className = 'stack';

    for (const o of observations) {
      const card = document.createElement('details');
      card.className = 'card obs-record';

      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.className = 'card__title';
      title.textContent = `${fmtDate(o.timestamp)} — ${o.outcome}`;
      const meta = document.createElement('span');
      meta.className = 'card__meta';
      meta.style.display = 'block';
      meta.textContent = summarizeObservation(o);
      summary.append(title, meta);
      card.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'stack';
      body.style.marginTop = '8px';

      const list = document.createElement('ul');
      list.className = 'instructions';
      observationDetails(o, list);
      if (!list.childNodes.length) {
        const li = document.createElement('li');
        li.textContent = 'No individual answers were recorded for this observation.';
        list.appendChild(li);
      }
      body.appendChild(list);

      const s = o.settings;
      const settingsDl = document.createElement('dl');
      settingsDl.className = 'kv';
      settingsDl.innerHTML = `
        <dt>Lens orientation</dt><dd>${s.lensOrientation} (red over ${s.redEye})</dd>
        <dt>Declared weaker eye</dt><dd>${s.amblyopicEye}</dd>
        <dt>Fellow contrast</dt><dd>${Math.round(s.fellowContrast * 100)}%</dd>
        <dt>Red / cyan</dt><dd>rgb(${s.redColor.r},${s.redColor.g},${s.redColor.b}) / rgb(${s.cyanColor.r},${s.cyanColor.g},${s.cyanColor.b})</dd>
        <dt>Eye trims</dt><dd>L ${Math.round(s.leftEyeTrim * 100)}% · R ${Math.round(s.rightEyeTrim * 100)}%</dd>
        <dt>Display estimate</dt><dd>${s.screenMmPerPx == null ? 'not set' : s.screenMmPerPx.toFixed(4) + ' mm/px'} (${s.screenMethod})</dd>
        <dt>Viewing distance</dt><dd>${s.viewingDistanceCm} cm</dd>
        <dt>Schema version</dt><dd>${o.schemaVersion}</dd>
      `;
      body.appendChild(settingsDl);
      card.appendChild(body);
      obsList.appendChild(card);
    }

    screen.appendChild(obsList);
  }

  root.appendChild(screen);
  return () => screen.remove();
}

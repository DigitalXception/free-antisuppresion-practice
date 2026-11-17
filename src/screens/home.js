/*!
 * home.js — landing screen.
 *
 * Entry points: Play (readiness → games), Binocular observations (guided
 * self-report, not a screening score), Calibration, Settings, Session log.
 */

import { getObservations, getSessions } from '../store.js';

export function mountHome(root) {
  const screen = document.createElement('div');
  screen.className = 'screen';

  const observations = getObservations().length;
  const sessionCount = getSessions().length;

  screen.innerHTML = `
    <header class="stack" style="gap:6px;">
      <h1>Anti-Suppression Practice</h1>
      <p class="subtle">Dichoptic (red/cyan) visual practice for amblyopia research.</p>
    </header>

    <div class="banner">
      <strong>Research prototype — not a medical assessment or treatment.</strong>
      This app is an experimental tool for exploring anti-suppression exercises.
      It has not been clinically validated and makes no therapeutic claims.
      Stop if you notice double vision or discomfort, and do not push on through symptoms.
      New or persistent double vision outside this app needs professional assessment;
      sudden new double vision needs prompt care. It is not a substitute for advice
      from an eye-care professional.
    </div>

    <div class="stack">
      <button class="btn--primary btn--big" data-go="readiness">Play</button>
      <button class="btn--big" data-go="observations">
        Binocular observations
        <span class="faint" style="display:block;font-size:0.8rem;font-weight:400;">
          Optional guided checks of what each eye sees — not a screening score
        </span>
      </button>
      <div class="btn-grid btn-grid--2">
        <button data-go="calibration">Calibration</button>
        <button data-go="settings">Settings</button>
      </div>
      <button data-go="log">Session log${sessionCount || observations ? ` (${sessionCount} sessions · ${observations} observations)` : ''}</button>
    </div>

    <hr>

    <div class="card">
      <h2>Before you start</h2>
      <ol class="instructions" style="margin:0;padding-left:1.15rem;">
        <li>Put on your red/cyan (or red/blue) anaglyph glasses.</li>
        <li>Run <strong>Calibration</strong> so each eye's colour is set, then set the per-eye brightness manually if you need to.</li>
        <li>Set your screen size (card calibration) and viewing distance.</li>
        <li>Optionally run <strong>Binocular observations</strong> to record what you see. Observations are stored separately from game sessions.</li>
        <li>Take frequent breaks. Stop if you feel eye strain, headache, or nausea.</li>
      </ol>
    </div>

    <p class="faint">
      Works best fullscreen on a bright display in a dim room. Keep the screen at
      a comfortable viewing distance and avoid tilting your head.
    </p>
  `;

  screen.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-go]');
    if (!btn) return;
    location.hash = '#' + btn.dataset.go;
  });

  root.appendChild(screen);
  return () => screen.remove();
}

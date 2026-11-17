/*!
 * settings.js — session length, viewing distance, reset calibration.
 */

import { getSettings, saveSettings, clearSessions, clearObservations } from '../store.js';
import { describeScreenSize, estimateScreenSize, openCardCalibration, isLikelyMobile } from '../display.js';

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

export function mountSettings(root) {
  let settings = getSettings();

  const screen = document.createElement('div');
  screen.className = 'screen';

  const header = document.createElement('div');
  header.className = 'stack';
  header.innerHTML = `
    <h1>Settings</h1>
    <p class="subtle">Session and display preferences.</p>
  `;

  /* ---- Session length ---- */
  const s1 = section('Session length', 'How long a practice session runs before it stops itself.');

  const field = document.createElement('div');
  field.className = 'field';

  const lab = document.createElement('div');
  lab.className = 'field__label';
  const labText = document.createElement('span');
  labText.textContent = 'Length';
  const val = document.createElement('span');
  val.className = 'field__value';
  val.textContent = `${settings.sessionLengthMin} min`;
  lab.append(labText, val);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '5';
  range.max = '60';
  range.step = '5';
  range.value = String(settings.sessionLengthMin);
  range.setAttribute('aria-label', 'Session length in minutes');

  range.addEventListener('input', () => {
    const v = Math.round(parseFloat(range.value));
    val.textContent = `${v} min`;
    settings = saveSettings({ sessionLengthMin: v });
    updateSummary();
  });

  field.append(lab, range);

  const quick = document.createElement('div');
  quick.className = 'toolbar';
  for (const m of [5, 10, 20, 30, 45, 60]) {
    const b = document.createElement('button');
    b.textContent = `${m}m`;
    b.style.minHeight = '38px';
    b.style.padding = '6px 12px';
    b.addEventListener('click', () => {
      range.value = String(m);
      settings = saveSettings({ sessionLengthMin: m });
      val.textContent = `${m} min`;
      updateSummary();
    });
    quick.appendChild(b);
  }

  s1.append(field, quick);

  /* ---- Viewing distance ---- */
  const s2 = section('Viewing distance', 'Distance from your eyes to the screen. Used for visual-angle maths.');

  const distField = document.createElement('div');
  distField.className = 'field';
  const distLab = document.createElement('div');
  distLab.className = 'field__label';
  const distText = document.createElement('span');
  distText.textContent = 'Distance';
  const distVal = document.createElement('span');
  distVal.className = 'field__value';
  distVal.textContent = `${settings.viewingDistanceCm} cm`;
  distLab.append(distText, distVal);

  const distRange = document.createElement('input');
  distRange.type = 'range';
  distRange.min = '25';
  distRange.max = '150';
  distRange.step = '5';
  distRange.value = String(settings.viewingDistanceCm);
  distRange.setAttribute('aria-label', 'Viewing distance in centimetres');
  distRange.addEventListener('input', () => {
    const v = Math.round(parseFloat(distRange.value));
    distVal.textContent = `${v} cm`;
    settings = saveSettings({ viewingDistanceCm: v });
    updateSummary();
  });

  distField.append(distLab, distRange);
  s2.appendChild(distField);

  /* ---- Display summary ---- */
  const s3 = section('Display', 'Physical size estimate for the screen.');
  const summary = document.createElement('dl');
  summary.className = 'kv';

  function row(k, v) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    summary.append(dt, dd);
    return dd;
  }

  const dSize = row('Screen size', '');
  row('Device class', isLikelyMobile() ? 'phone/tablet' : 'desktop');
  const dLens = row('Lens orientation', '');
  const dEye = row('Weaker (amblyopic) eye', '');
  const dContrast = row('Fellow-eye contrast', '');

  const cardBtn = document.createElement('button');
  cardBtn.className = 'btn--full';
  cardBtn.textContent = 'Recalibrate screen size with a card';
  cardBtn.addEventListener('click', () => {
    openCardCalibration(() => updateSummary());
  });

  s3.append(summary, cardBtn);

  /* ---- Reset ---- */
  const s4 = section('Reset', 'Restore defaults or clear stored data.');
  const resetCal = document.createElement('button');
  resetCal.className = 'btn--danger btn--full';
  resetCal.textContent = 'Reset calibration';

  resetCal.addEventListener('click', () => {
    if (!confirm('Reset calibration? Lens orientation, eye colours, trims, fellow contrast and screen size return to defaults.')) {
      return;
    }
    saveSettings({
      lensOrientation: 'RL',
      amblyopicEye: 'right',
      fellowContrast: 0.20,
      redColor: { r: 255, g: 0, b: 0 },
      cyanColor: { r: 0, g: 255, b: 255 },
      leftEyeTrim: 1.0,
      rightEyeTrim: 1.0,
      screenMmPerPx: null,
      screenMethod: 'guessed'
    });
    estimateScreenSize();
    settings = getSettings();

    distRange.value = String(settings.viewingDistanceCm);
    distVal.textContent = `${settings.viewingDistanceCm} cm`;
    range.value = String(settings.sessionLengthMin);
    val.textContent = `${settings.sessionLengthMin} min`;
    // Refresh every display row (screen size, lens, eye, contrast), not just size.
    updateSummary();
  });

  const clearLog = document.createElement('button');
  clearLog.className = 'btn--danger btn--full';
  clearLog.textContent = 'Clear session log';
  clearLog.addEventListener('click', () => {
    if (!confirm('Delete all saved sessions? This cannot be undone.')) return;
    clearSessions();
  });

  const clearObs = document.createElement('button');
  clearObs.className = 'btn--danger btn--full';
  clearObs.textContent = 'Clear binocular observations';
  clearObs.addEventListener('click', () => {
    if (!confirm('Delete all saved binocular observations? Game sessions are kept. This cannot be undone.')) {
      return;
    }
    clearObservations();
  });

  s4.append(resetCal, clearLog, clearObs);

  /* ---- Footer ---- */
  const back = document.createElement('button');
  back.className = 'btn--primary btn--full';
  back.textContent = 'Back';
  back.addEventListener('click', () => {
    location.hash = '#home';
  });

  screen.append(header, s1, s2, s3, s4, back);
  root.appendChild(screen);

  function updateSummary() {
    settings = getSettings();
    dSize.textContent = describeScreenSize();
    dLens.textContent =
      settings.lensOrientation === 'LR' ? 'Red right / cyan left' : 'Red left / cyan right';
    dEye.textContent = settings.amblyopicEye;
    dContrast.textContent =
      (settings.amblyopicEye === 'equal' ? 'n/a (equal)' : Math.round(settings.fellowContrast * 100) + '%');
  }

  updateSummary();

  return () => screen.remove();
}

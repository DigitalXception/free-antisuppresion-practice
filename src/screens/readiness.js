/*!
 * readiness.js — plain pre-game readiness screen.
 *
 * Replaces the previous offset-line "alignment gate". Nothing here asks the
 * user to declare that two offset lines look aligned: that instruction was not
 * supported by anything in the app and implied a physical alignment check that
 * a browser cannot perform.
 *
 * The screen only explains that the game image is split between the two eyes,
 * offers the optional observations shortcut, and lets the user start or go back.
 */

import { getSettings } from '../store.js';

export function mountReadiness(root, ctx) {
  const settings = getSettings();

  const screen = document.createElement('main');
  screen.className = 'screen';

  const header = document.createElement('header');
  header.className = 'stack';
  header.innerHTML = `
    <h1>Ready to play?</h1>
    <p class="subtle">Falling Blocks splits the image between your two eyes.</p>
  `;

  const how = document.createElement('section');
  how.className = 'card';
  how.append(Object.assign(document.createElement('h2'), { textContent: 'What you will see' }));

  // Equal mode has no weaker eye: the renderer gives both eyes the same content,
  // so the split-content sentence must not claim a weaker-eye destination there.
  const isEqual = settings.amblyopicEye === 'equal';

  const list = document.createElement('ul');
  list.className = 'instructions';
  for (const text of [
    'Wear your red/cyan glasses with the correct lens over each eye.',
    isEqual
      ? 'The eyes are set to equal, so both eyes receive the same content — no weaker eye is set, and no element is sent to one eye only.'
      : 'Some elements are drawn for one eye only, so each eye receives different content.',
    isEqual
      ? 'The falling piece and the settled stack are shown to both eyes alike.'
      : `The falling piece goes to your declared weaker eye (${settings.amblyopicEye}), the settled stack to the other eye.`,
    'The border and the bottom two rows are drawn to both eyes as a shared reference.',
    'The playfield is static apart from the game itself; nothing flashes and there is nothing to confirm or declare before you start.'
  ]) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }
  how.appendChild(list);

  const lens = document.createElement('dl');
  lens.className = 'kv';
  lens.innerHTML = `
    <dt>Lens orientation</dt><dd>${settings.lensOrientation === 'LR' ? 'Red right / cyan left' : 'Red left / cyan right'}</dd>
    <dt>Declared weaker eye</dt><dd>${settings.amblyopicEye}</dd>
    <dt>Fellow-eye contrast</dt><dd>${settings.amblyopicEye === 'equal' ? 'n/a (equal)' : Math.round(settings.fellowContrast * 100) + '%'}</dd>
    <dt>Session length</dt><dd>${settings.sessionLengthMin} min</dd>
  `;
  how.appendChild(lens);
  how.appendChild(
    Object.assign(document.createElement('p'), {
      className: 'faint',
      textContent:
        'If these do not match your glasses or your intention, adjust them in Calibration or Settings first. Nothing is changed from this screen.'
    })
  );

  const note = document.createElement('aside');
  note.className = 'banner';
  note.innerHTML =
    '<strong>Stop if it is uncomfortable.</strong> Do not persist with double vision, eye strain, headache or nausea. ' +
    'This is a research prototype, not a medical treatment.';

  const actions = document.createElement('div');
  actions.className = 'stack';

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn--primary btn--big';
  start.textContent = 'Start Falling Blocks';
  start.addEventListener('click', () => {
    ctx.navigate('tetris');
  });

  const obs = document.createElement('button');
  obs.type = 'button';
  obs.className = 'btn--ghost';
  obs.textContent = 'Optional: binocular observations first';
  obs.addEventListener('click', () => {
    ctx.navigate('observations');
  });

  const calib = document.createElement('button');
  calib.type = 'button';
  calib.className = 'btn--ghost';
  calib.textContent = 'Calibration';
  calib.addEventListener('click', () => {
    ctx.navigate('calibration');
  });

  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Back';
  back.addEventListener('click', () => {
    ctx.navigate('home');
  });

  actions.append(start, obs, calib, back);

  screen.append(header, note, how, actions);
  root.appendChild(screen);

  return () => screen.remove();
}

export default mountReadiness;

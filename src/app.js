/*!
 * app.js — hash router + screen lifecycle.
 *
 * Routes: #home (default), #readiness, #calibration, #settings, #games,
 *         #tetris, #log, #observations
 * Each screen module exports mount<Name>(root, ctx) which returns a
 * disposer function. The router always calls the disposer before mounting the
 * next screen so canvases, RAF loops and listeners are released.
 */

import { mountHome } from './screens/home.js';
import { mountReadiness } from './screens/readiness.js';
import { mountCalibration } from './screens/calibration.js';
import { mountSettings } from './screens/settings.js';
import { mountGameSelect } from './screens/gameselect.js';
import { mountLog } from './screens/log.js';
import { mountObservations } from './screens/observations.js';
import { mountTetris } from './games/tetris.js';
import { getSettings } from './store.js';
import { estimateScreenSize } from './display.js';

const ROUTES = {
  home: mountHome,
  readiness: mountReadiness,
  calibration: mountCalibration,
  settings: mountSettings,
  games: mountGameSelect,
  tetris: mountTetris,
  log: mountLog,
  observations: mountObservations
};

const DEFAULT_ROUTE = 'home';

let disposeCurrent = null;
let currentRoute = null;
let mountToken = 0;

function parseRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim().toLowerCase();
  if (!raw) return DEFAULT_ROUTE;
  return Object.prototype.hasOwnProperty.call(ROUTES, raw) ? raw : DEFAULT_ROUTE;
}

function unmount() {
  if (typeof disposeCurrent === 'function') {
    try {
      disposeCurrent();
    } catch (err) {
      console.error('[app] screen teardown failed', err);
    }
  }
  disposeCurrent = null;
  const root = document.getElementById('app');
  if (root) root.replaceChildren();
}

async function render() {
  const route = parseRoute();
  const token = ++mountToken;

  unmount();
  currentRoute = route;

  const root = document.getElementById('app');
  if (!root) return;

  const mount = ROUTES[route] || ROUTES[DEFAULT_ROUTE];
  const ctx = {
    route,
    navigate(hash) {
      const target = '#' + String(hash).replace(/^#/, '');
      if (location.hash === target) {
        render();
      } else {
        location.hash = target;
      }
    },
    settings: getSettings()
  };

  try {
    const result = await mount(root, ctx);
    if (token !== mountToken) {
      // A newer navigation already happened — discard this screen.
      if (typeof result === 'function') result();
      return;
    }
    disposeCurrent = typeof result === 'function' ? result : null;
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (err) {
    console.error('[app] failed to mount', route, err);
    root.replaceChildren();
    const box = document.createElement('div');
    box.className = 'screen';
    box.innerHTML = `
      <h1>Something went wrong</h1>
      <p class="subtle">The “${route}” screen failed to load.</p>
      <pre class="faint" style="white-space:pre-wrap;overflow:auto;"></pre>
      <button class="btn--primary" id="err-home">Back to home</button>
    `;
    box.querySelector('pre').textContent = String((err && err.stack) || err);
    box.querySelector('#err-home').addEventListener('click', () => {
      location.hash = '#home';
    });
    root.appendChild(box);
  }
}

function init() {
  // Ensure a screen-size estimate exists before anything asks for it.
  const settings = getSettings();
  if (!settings.screenMmPerPx) {
    estimateScreenSize();
  } else if (settings.screenMethod === 'guessed') {
    // Keep the guess in sync with the current device class on load.
    estimateScreenSize();
  }

  if (!location.hash) {
    // Replace rather than push so the back button leaves the app cleanly.
    history.replaceState(null, '', location.pathname + location.search + '#home');
  }

  window.addEventListener('hashchange', () => {
    render();
  });

  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

export { render as rerender };

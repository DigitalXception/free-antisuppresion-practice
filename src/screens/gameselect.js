/*!
 * gameselect.js — game picker.
 *
 * Selecting an enabled game goes to the plain readiness screen first
 * (#readiness), which explains the split image and offers the optional
 * observations shortcut. There is no alignment declaration.
 */

const GAMES = [
  {
    id: 'tetris',
    title: 'Falling Blocks',
    desc: 'Falling tetrominoes. The active piece is shown only to the amblyopic eye; landed blocks go to the fellow eye; the bottom two rows are a fusion lock.',
    enabled: true,
    hash: 'readiness'
  },
  {
    id: 'motion',
    title: 'Motion Dots',
    desc: 'Coherent motion discrimination with dichoptic masking.',
    enabled: false,
    hash: null
  },
  {
    id: 'hidden3d',
    title: 'Hidden 3D Shape',
    desc: 'Find a shape defined only by inter-ocular disparity.',
    enabled: false,
    hash: null
  }
];

export function mountGameSelect(root) {
  const screen = document.createElement('div');
  screen.className = 'screen';

  const header = document.createElement('div');
  header.className = 'stack';
  header.innerHTML = `
    <h1>Games</h1>
    <p class="subtle">Each game splits the image between your two eyes. Wear your glasses.</p>
  `;

  const obsLink = document.createElement('button');
  obsLink.className = 'btn--ghost btn--full';
  obsLink.textContent = 'Optional: binocular observations';
  obsLink.addEventListener('click', () => {
    location.hash = '#observations';
  });

  const list = document.createElement('div');
  list.className = 'stack';

  for (const g of GAMES) {
    const card = document.createElement(g.enabled ? 'button' : 'div');
    card.className = 'card card--selectable' + (g.enabled ? '' : ' card--disabled');

    const titleRow = document.createElement('div');
    titleRow.className = 'row';
    titleRow.style.justifyContent = 'space-between';

    const title = document.createElement('span');
    title.className = 'card__title';
    title.textContent = g.title;

    titleRow.appendChild(title);

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = g.enabled ? 'Ready' : 'Coming soon';
    titleRow.appendChild(badge);

    const desc = document.createElement('p');
    desc.className = 'card__meta';
    desc.style.margin = '0';
    desc.textContent = g.desc;

    card.appendChild(titleRow);
    card.appendChild(desc);

    if (g.enabled) {
      card.type = 'button';
      card.dataset.go = g.hash;
      card.addEventListener('click', () => {
        location.hash = '#' + g.hash;
      });
    } else {
      card.setAttribute('aria-disabled', 'true');
    }

    list.appendChild(card);
  }

  const back = document.createElement('button');
  back.dataset.go = 'home';
  back.textContent = 'Back';
  back.addEventListener('click', () => {
    location.hash = '#home';
  });

  screen.append(header, obsLink, list, back);
  root.appendChild(screen);

  return () => screen.remove();
}

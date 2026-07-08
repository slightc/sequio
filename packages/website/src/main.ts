import './styles.css';
import { h } from './dom';
import { startRouter, type Route } from './router';
import { homePage } from './pages/home';
import { demosPage } from './pages/demos';
import { codePage } from './pages/code';
import { apiPage } from './pages/api';
import { studioPage } from './pages/studio';

const REPO = 'https://github.com/slightc/sequio';

const NAV = [
  { path: '/', label: 'Home' },
  { path: '/demos', label: 'Demos' },
  { path: '/api', label: 'API' },
  { path: '/studio', label: 'Studio' },
];

const routes: Route[] = [
  { path: '/', page: homePage },
  { path: '/demos', page: demosPage },
  { path: '/code', page: codePage },
  { path: '/api', page: apiPage },
  { path: '/studio', page: studioPage },
];

/** Build the sticky nav + footer once; return a fn that syncs the active link. */
function mountChrome(): (path: string) => void {
  const navEl = document.getElementById('nav') as HTMLElement;
  const links = NAV.map((item) =>
    h('a', { class: 'navlink', href: `#${item.path}`, 'data-path': item.path }, item.label),
  );
  navEl.append(
    h(
      'div',
      { class: 'bar' },
      h(
        'a',
        { class: 'brand', href: '#/' },
        h('span', { class: 'logo' }),
        h('span', { class: 'full' }, 'sequio'),
      ),
      h('span', { class: 'spacer' }),
      h('nav', {}, ...links),
      h('a', { class: 'nav-gh', href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub ↗'),
    ),
  );

  const footEl = document.getElementById('foot') as HTMLElement;
  footEl.append(
    h(
      'div',
      { class: 'wrap' },
      h(
        'div',
        { class: 'bar' },
        h('span', {}, 'sequio · programmable timelines for web video and AI'),
        h('span', { class: 'spacer' }),
        h('a', { href: `${REPO}#readme`, target: '_blank', rel: 'noopener' }, 'README'),
        h('a', { href: `${REPO}/tree/main/docs`, target: '_blank', rel: 'noopener' }, 'Docs'),
        h('a', { href: 'https://www.npmjs.com/package/@sequio/engine', target: '_blank', rel: 'noopener' }, 'npm'),
        h('span', { class: 'pill' }, 'MIT'),
      ),
    ),
  );

  return (path: string): void => {
    for (const link of links) {
      const linkPath = link.getAttribute('data-path')!;
      const active = linkPath === path || (linkPath === '/demos' && path === '/code');
      link.classList.toggle('active', active);
    }
  };
}

const setActive = mountChrome();
startRouter({
  routes,
  view: document.getElementById('view') as HTMLElement,
  onNavigate: setActive,
  notFound: ({ view }) => {
    view.append(
      h(
        'section',
        { class: 'section' },
        h(
          'div',
          { class: 'wrap center' },
          h('h2', {}, '404'),
          h('p', { class: 'lead', style: 'margin: 12px auto 20px' }, 'That page does not exist.'),
          h('a', { class: 'btn', href: '#/' }, 'Back home'),
        ),
      ),
    );
  },
});

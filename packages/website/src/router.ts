/**
 * A tiny hash router. The whole site is one page (`index.html`); the URL after
 * `#` selects which view renders into `<main id="view">`. Each page is a
 * function that fills the view and optionally returns a cleanup callback — Code
 * Mode uses that to tear down its live PixiJS preview + clock before the next
 * route mounts.
 */
export interface RouteContext {
  /** The container to render into. */
  view: HTMLElement;
  /** Query params after the path (e.g. `#/code?demo=hello`). */
  params: URLSearchParams;
  /** Programmatic navigation. */
  navigate: (to: string) => void;
}

/** A page renders into the view and may return a teardown for when it unmounts. */
export type Page = (ctx: RouteContext) => void | (() => void);

export interface Route {
  /** Path without the leading `#`, e.g. `/`, `/demos`, `/code`. */
  path: string;
  page: Page;
}

export interface RouterOptions {
  routes: Route[];
  view: HTMLElement;
  /** Called after each navigation with the active path (to sync nav highlight). */
  onNavigate?: (path: string) => void;
  /** Rendered when no route matches. */
  notFound?: Page;
}

/** Split `#/code?demo=hello` → `{ path: '/code', params }`. */
function parseHash(hash: string): { path: string; params: URLSearchParams } {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

export function startRouter(options: RouterOptions): void {
  const { routes, view, onNavigate, notFound } = options;
  let cleanup: (() => void) | void;

  const navigate = (to: string): void => {
    const target = to.startsWith('#') ? to : `#${to}`;
    if (location.hash === target) render();
    else location.hash = target;
  };

  const render = (): void => {
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;

    const { path, params } = parseHash(location.hash);
    const route = routes.find((r) => r.path === path);
    const page = route?.page ?? notFound;

    view.replaceChildren();
    view.scrollTop = 0;
    window.scrollTo({ top: 0 });

    if (page) cleanup = page({ view, params, navigate });
    onNavigate?.(route ? path : '');
  };

  window.addEventListener('hashchange', render);
  render();
}

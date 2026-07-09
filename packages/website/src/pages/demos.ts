import { h } from '../dom';
import type { Page } from '../router';
import { DEMOS } from '../demos';
import { mountCover, type CoverHandle } from '../cover';

export const demosPage: Page = ({ view, navigate }) => {
  const covers: CoverHandle[] = [];

  const cards = DEMOS.map((demo) => {
    const cover = h(
      'div',
      { class: 'demo-cover' },
      h('span', { class: 'cover-badge' }, 'rendered by Sequio'),
      h('div', { class: 'cover-fallback' }, 'rendering…'),
    );
    // Mount a live, looping sequio preview as the card's cover.
    covers.push(mountCover(cover, demo));

    return h(
      'button',
      {
        class: 'demo-card',
        type: 'button',
        onClick: () => navigate(`/code?demo=${demo.id}`),
        'aria-label': `Open ${demo.title} in Code Mode`,
      },
      cover,
      h(
        'div',
        { class: 'body' },
        h('h3', {}, demo.title),
        h('p', {}, demo.description),
        h('div', { class: 'tags' }, ...demo.tags.map((t) => h('span', { class: 'tag' }, t))),
        h('div', { class: 'open-hint' }, 'Open in Code Mode  →'),
      ),
    );
  });

  const header = h(
    'div',
    { class: 'wrap', style: 'padding-top: 56px' },
    h('div', { class: 'eyebrow' }, 'Demo gallery'),
    h('h2', { style: 'font-size: clamp(28px,4vw,40px)' }, 'Live compositions, drawn by the engine'),
    h(
      'p',
      { class: 'lead', style: 'margin-top: 12px' },
      'Each cover is a real ',
      h('code', {}, 'Composer'),
      ' preview looping in your browser — shapes, text, effects and GSAP, a pair that pull a still image and a video straight off the network, and the CLI’s multi-file showcase compositions (a bring-your-own-FX reel plus three editorial promos) shown verbatim. Click a card to open its source in Code Mode and re-run it.',
    ),
  );

  const grid = h('div', { class: 'wrap', style: 'padding: 30px 24px 72px' }, h('div', { class: 'demo-grid' }, ...cards));

  view.append(h('section', { style: 'padding-bottom: 8px' }, header), grid);

  // Tear down every live preview when leaving the gallery.
  return () => {
    for (const c of covers) c.dispose();
  };
};

import { describe, expect, it } from 'vitest';
import { parseGoogleFontUrls } from '../src/fonts-node';

describe('parseGoogleFontUrls', () => {
  it('pulls the font-file URLs out of a css2 stylesheet (bare + quoted)', () => {
    const css = `
      /* latin */
      @font-face {
        font-family: 'Roboto';
        font-style: normal;
        font-weight: 400;
        src: url(https://fonts.gstatic.com/s/roboto/v30/abc.woff2) format('woff2');
      }
      @font-face {
        font-family: 'Roboto';
        font-weight: 700;
        src: url("https://fonts.gstatic.com/s/roboto/v30/def.ttf") format('truetype');
      }
    `;
    expect(parseGoogleFontUrls(css)).toEqual([
      'https://fonts.gstatic.com/s/roboto/v30/abc.woff2',
      'https://fonts.gstatic.com/s/roboto/v30/def.ttf',
    ]);
  });

  it('returns an empty list when there are no @font-face src urls', () => {
    expect(parseGoogleFontUrls('body { color: red; }')).toEqual([]);
  });
});

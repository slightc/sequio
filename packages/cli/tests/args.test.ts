import { describe, expect, it } from 'vitest';
import { DEFAULT_PREVIEW_PORT, parseArgs } from '../src/args';

describe('parseArgs', () => {
  it('no args → help', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
  });

  it('tolerates a leading `--` (pnpm run forwarding)', () => {
    expect(parseArgs(['--', 'render', 'a.ts'])).toMatchObject({ kind: 'render', file: 'a.ts' });
    expect(parseArgs(['--', '--version'])).toEqual({ kind: 'version' });
    expect(parseArgs(['--'])).toEqual({ kind: 'help' });
  });

  it('global help / version flags', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['-v'])).toEqual({ kind: 'version' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('unknown command → error', () => {
    expect(parseArgs(['frobnicate'])).toMatchObject({ kind: 'error' });
  });

  describe('render', () => {
    it('bare file', () => {
      expect(parseArgs(['render', 'a.ts'])).toEqual({
        kind: 'render',
        file: 'a.ts',
        out: undefined,
        verify: false,
      });
    });

    it('--out / -o and --verify (order-independent)', () => {
      expect(parseArgs(['render', '--verify', '-o', 'x.mp4', 'a.ts'])).toEqual({
        kind: 'render',
        file: 'a.ts',
        out: 'x.mp4',
        verify: true,
      });
      expect(parseArgs(['render', 'a.ts', '--out', 'y.webm'])).toMatchObject({
        out: 'y.webm',
      });
    });

    it('missing file → error', () => {
      expect(parseArgs(['render'])).toMatchObject({ kind: 'error' });
    });

    it('--out without a value → error', () => {
      expect(parseArgs(['render', 'a.ts', '--out'])).toMatchObject({ kind: 'error' });
    });

    it('unknown option → error', () => {
      expect(parseArgs(['render', 'a.ts', '--nope'])).toMatchObject({ kind: 'error' });
    });

    it('extra positional → error', () => {
      expect(parseArgs(['render', 'a.ts', 'b.ts'])).toMatchObject({ kind: 'error' });
    });
  });

  describe('preview', () => {
    it('defaults', () => {
      expect(parseArgs(['preview', 'a.ts'])).toEqual({
        kind: 'preview',
        file: 'a.ts',
        watch: false,
        host: false,
        port: DEFAULT_PREVIEW_PORT,
      });
    });

    it('--watch / --host / --port', () => {
      expect(parseArgs(['preview', 'a.ts', '-w', '--host', '-p', '7000'])).toEqual({
        kind: 'preview',
        file: 'a.ts',
        watch: true,
        host: true,
        port: 7000,
      });
    });

    it('invalid port → error', () => {
      expect(parseArgs(['preview', 'a.ts', '-p', 'abc'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['preview', 'a.ts', '-p', '0'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['preview', 'a.ts', '-p', '99999'])).toMatchObject({ kind: 'error' });
    });

    it('missing file → error', () => {
      expect(parseArgs(['preview', '--watch'])).toMatchObject({ kind: 'error' });
    });
  });
});

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
        scale: 1,
        verify: false,
      });
    });

    it('--out / -o and --verify (order-independent)', () => {
      expect(parseArgs(['render', '--verify', '-o', 'x.mp4', 'a.ts'])).toEqual({
        kind: 'render',
        file: 'a.ts',
        out: 'x.mp4',
        scale: 1,
        verify: true,
      });
      expect(parseArgs(['render', 'a.ts', '--out', 'y.webm'])).toMatchObject({
        out: 'y.webm',
      });
    });

    it('--scale / -s', () => {
      expect(parseArgs(['render', 'a.ts', '--scale', '2'])).toMatchObject({ scale: 2 });
      expect(parseArgs(['render', 'a.ts', '-s', '1.5'])).toMatchObject({ scale: 1.5 });
    });

    it('invalid scale → error', () => {
      expect(parseArgs(['render', 'a.ts', '--scale', '0'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['render', 'a.ts', '--scale', 'abc'])).toMatchObject({ kind: 'error' });
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

  describe('frame', () => {
    it('bare file → defaults (t=0, frame.png, 1×)', () => {
      expect(parseArgs(['frame', 'a.ts'])).toEqual({
        kind: 'frame',
        file: 'a.ts',
        time: 0,
        out: undefined,
        scale: 1,
      });
    });

    it('--time / -t and --out / -o (order-independent)', () => {
      expect(parseArgs(['frame', '-t', '2.5', '-o', 'shot.png', 'a.ts'])).toEqual({
        kind: 'frame',
        file: 'a.ts',
        time: 2.5,
        out: 'shot.png',
        scale: 1,
      });
      expect(parseArgs(['frame', 'a.ts', '--time', '0'])).toMatchObject({ time: 0 });
    });

    it('--scale / -s', () => {
      expect(parseArgs(['frame', 'a.ts', '--scale', '2'])).toMatchObject({ scale: 2 });
    });

    it('invalid time → error', () => {
      expect(parseArgs(['frame', 'a.ts', '--time', '-1'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['frame', 'a.ts', '-t', 'abc'])).toMatchObject({ kind: 'error' });
    });

    it('invalid scale → error', () => {
      expect(parseArgs(['frame', 'a.ts', '--scale', '0'])).toMatchObject({ kind: 'error' });
    });

    it('missing file → error', () => {
      expect(parseArgs(['frame', '-t', '1'])).toMatchObject({ kind: 'error' });
    });

    it('--time without a value → error', () => {
      expect(parseArgs(['frame', 'a.ts', '--time'])).toMatchObject({ kind: 'error' });
    });

    it('unknown option / extra positional → error', () => {
      expect(parseArgs(['frame', 'a.ts', '--nope'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['frame', 'a.ts', 'b.ts'])).toMatchObject({ kind: 'error' });
    });
  });

  describe('audio', () => {
    it('bare file → defaults (out/format/bitrate undefined)', () => {
      expect(parseArgs(['audio', 'a.ts'])).toEqual({
        kind: 'audio',
        file: 'a.ts',
        out: undefined,
        format: undefined,
        bitrate: undefined,
      });
    });

    it('--out / -o, --format / -f and --bitrate / -b (order-independent)', () => {
      expect(parseArgs(['audio', '-f', 'mp3', '-o', 'song.mp3', '-b', '192000', 'a.ts'])).toEqual({
        kind: 'audio',
        file: 'a.ts',
        out: 'song.mp3',
        format: 'mp3',
        bitrate: 192000,
      });
      expect(parseArgs(['audio', 'a.ts', '--format', 'wav'])).toMatchObject({ format: 'wav' });
    });

    it('invalid format → error', () => {
      expect(parseArgs(['audio', 'a.ts', '--format', 'flac'])).toMatchObject({ kind: 'error' });
    });

    it('invalid bitrate → error', () => {
      expect(parseArgs(['audio', 'a.ts', '--bitrate', '0'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['audio', 'a.ts', '-b', 'abc'])).toMatchObject({ kind: 'error' });
    });

    it('missing file → error', () => {
      expect(parseArgs(['audio', '-f', 'mp3'])).toMatchObject({ kind: 'error' });
    });

    it('--out / --format without a value → error', () => {
      expect(parseArgs(['audio', 'a.ts', '--out'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['audio', 'a.ts', '--format'])).toMatchObject({ kind: 'error' });
    });

    it('unknown option / extra positional → error', () => {
      expect(parseArgs(['audio', 'a.ts', '--nope'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['audio', 'a.ts', 'b.ts'])).toMatchObject({ kind: 'error' });
    });
  });

  describe('check', () => {
    it('bare file → defaults (json false)', () => {
      expect(parseArgs(['check', 'a.ts'])).toEqual({
        kind: 'check',
        file: 'a.ts',
        json: false,
      });
    });

    it('--json (order-independent)', () => {
      expect(parseArgs(['check', '--json', 'a.ts'])).toEqual({
        kind: 'check',
        file: 'a.ts',
        json: true,
      });
      expect(parseArgs(['check', 'a.ts', '--json'])).toMatchObject({ json: true });
    });

    it('missing file → error', () => {
      expect(parseArgs(['check'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['check', '--json'])).toMatchObject({ kind: 'error' });
    });

    it('unknown option / extra positional → error', () => {
      expect(parseArgs(['check', 'a.ts', '--nope'])).toMatchObject({ kind: 'error' });
      expect(parseArgs(['check', 'a.ts', 'b.ts'])).toMatchObject({ kind: 'error' });
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

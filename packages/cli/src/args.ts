/**
 * Pure argument parsing for the `sequio` CLI. Kept free of any I/O so it can be
 * unit-tested directly: hand it an argv array, get back a discriminated
 * {@link CliCommand} (or a help/version/error sentinel). `cli.ts` does the I/O.
 */

/** `sequio render <file> [-o out] [--scale N] [--verify]`. */
export interface RenderCommand {
  kind: 'render';
  /** Path to the entry composition file (its `defineComposition` default export). */
  file: string;
  /** Output video path. `undefined` → `out.mp4`. */
  out?: string;
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale: number;
  /** Assert a valid video container came out (non-zero exit otherwise). */
  verify: boolean;
}

/** `sequio preview <file> [--watch] [-p port] [--host]`. */
export interface PreviewCommand {
  kind: 'preview';
  /** Path to the entry composition file. */
  file: string;
  /** Re-run the composition in the browser whenever a project file changes. */
  watch: boolean;
  /** Dev-server port. @default 6180 */
  port: number;
  /** Bind to `0.0.0.0` (expose on the network) instead of localhost. */
  host: boolean;
}

/** `sequio frame <file> [-t sec] [-o out.png] [--scale N]`. */
export interface FrameCommand {
  kind: 'frame';
  /** Path to the entry composition file. */
  file: string;
  /** Time (seconds) to sample. Clamped to `[0, duration]`. @default 0 */
  time: number;
  /** Output image path. `undefined` → `frame.png`. */
  out?: string;
  /** Output resolution multiplier (N× the composition size). @default 1 */
  scale: number;
}

/** Show usage / version / a parse error and exit. */
export interface MetaCommand {
  kind: 'help' | 'version' | 'error';
  /** For `error`: the message to print (before usage) and exit non-zero. */
  message?: string;
}

export type CliCommand = RenderCommand | PreviewCommand | FrameCommand | MetaCommand;

export const DEFAULT_PREVIEW_PORT = 6180;

export const USAGE = `sequio — programmable-timeline CLI

Usage:
  sequio render <file> [options]     Encode a composition to a video file
  sequio frame <file> [options]      Export a single frame at a time as a PNG
  sequio preview <file> [options]    Serve a live in-browser preview

Render options (pure Node, PixiJS WebGPU — needs a GPU or Mesa lavapipe):
  -o, --out <path>     Output path (default: out.mp4)
  -s, --scale <n>      Render at n× the composition resolution (default: 1)
      --verify         Assert a valid video container came out

Frame options (pure Node, PixiJS WebGPU — needs a GPU or Mesa lavapipe):
  -t, --time <sec>     Timeline time to sample, in seconds (default: 0)
  -o, --out <path>     Output PNG path (default: frame.png)
  -s, --scale <n>      Render at n× the composition resolution (default: 1)

Preview options:
  -w, --watch          Re-run on any project-file change (live reload)
  -p, --port <n>       Dev-server port (default: ${DEFAULT_PREVIEW_PORT})
      --host           Expose the server on the local network (0.0.0.0)

Global:
  -h, --help           Show this help
  -v, --version        Print the version

<file> is a TS/JS module whose default export is a
defineComposition(builder) (or a bare builder). Its sibling files are
bundled with it, so relative imports (./scene, ./title) resolve.`;

/** Parse `process.argv.slice(2)` into a {@link CliCommand}. Never throws. */
export function parseArgs(argv: string[]): CliCommand {
  // Tolerate a leading `--` (e.g. `pnpm run sequio -- render …` forwards it).
  if (argv[0] === '--') argv = argv.slice(1);
  if (argv.length === 0) return { kind: 'help' };

  // Global flags win regardless of position, but only before a subcommand is
  // established; after that they're the subcommand's problem.
  const first = argv[0];
  if (first === '-h' || first === '--help') return { kind: 'help' };
  if (first === '-v' || first === '--version') return { kind: 'version' };

  if (first === 'render') return parseRender(argv.slice(1));
  if (first === 'frame') return parseFrame(argv.slice(1));
  if (first === 'preview') return parsePreview(argv.slice(1));

  return { kind: 'error', message: `Unknown command: ${first}` };
}

function parseRender(rest: string[]): CliCommand {
  let file: string | undefined;
  let out: string | undefined;
  let scale = 1;
  let verify = false;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') return { kind: 'help' };
    else if (a === '-o' || a === '--out') {
      out = rest[++i];
      if (out === undefined) return { kind: 'error', message: `${a} needs a path` };
    } else if (a === '-s' || a === '--scale') {
      const raw = rest[++i];
      const n = Number(raw);
      if (!(n >= 1) || !Number.isFinite(n)) return { kind: 'error', message: `${a} needs a number ≥ 1, got: ${raw}` };
      scale = n;
    } else if (a === '--verify') verify = true;
    else if (a.startsWith('-')) return { kind: 'error', message: `Unknown option: ${a}` };
    else if (file === undefined) file = a;
    else return { kind: 'error', message: `Unexpected argument: ${a}` };
  }

  if (file === undefined) return { kind: 'error', message: 'render needs a <file>' };
  return { kind: 'render', file, out, scale, verify };
}

function parseFrame(rest: string[]): CliCommand {
  let file: string | undefined;
  let out: string | undefined;
  let time = 0;
  let scale = 1;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') return { kind: 'help' };
    else if (a === '-o' || a === '--out') {
      out = rest[++i];
      if (out === undefined) return { kind: 'error', message: `${a} needs a path` };
    } else if (a === '-t' || a === '--time') {
      const raw = rest[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { kind: 'error', message: `${a} needs a number ≥ 0, got: ${raw}` };
      time = n;
    } else if (a === '-s' || a === '--scale') {
      const raw = rest[++i];
      const n = Number(raw);
      if (!(n >= 1) || !Number.isFinite(n)) return { kind: 'error', message: `${a} needs a number ≥ 1, got: ${raw}` };
      scale = n;
    } else if (a.startsWith('-')) return { kind: 'error', message: `Unknown option: ${a}` };
    else if (file === undefined) file = a;
    else return { kind: 'error', message: `Unexpected argument: ${a}` };
  }

  if (file === undefined) return { kind: 'error', message: 'frame needs a <file>' };
  return { kind: 'frame', file, time, out, scale };
}

function parsePreview(rest: string[]): CliCommand {
  let file: string | undefined;
  let watch = false;
  let host = false;
  let port = DEFAULT_PREVIEW_PORT;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-h' || a === '--help') return { kind: 'help' };
    else if (a === '-w' || a === '--watch') watch = true;
    else if (a === '--host') host = true;
    else if (a === '-p' || a === '--port') {
      const raw = rest[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) {
        return { kind: 'error', message: `${a} needs a valid port, got: ${raw}` };
      }
      port = n;
    } else if (a.startsWith('-')) return { kind: 'error', message: `Unknown option: ${a}` };
    else if (file === undefined) file = a;
    else return { kind: 'error', message: `Unexpected argument: ${a}` };
  }

  if (file === undefined) return { kind: 'error', message: 'preview needs a <file>' };
  return { kind: 'preview', file, watch, port, host };
}

/**
 * `sequio` CLI entry: parse argv, dispatch to `render` / `frame` / `preview`, own
 * the process lifecycle (exit codes, Ctrl-C). All the actual work lives in the
 * (independently testable) `args`, `render`, `frame` and `preview` modules.
 */
import { parseArgs, USAGE, type CliCommand } from './args';
import { runCheck } from './check';
import { runRender } from './render';
import { runFrame } from './frame';
import { runAudio } from './audio';
import { startPreviewServer } from './preview';
import { version } from './version';

async function main(argv: string[]): Promise<number> {
  const command: CliCommand = parseArgs(argv);

  switch (command.kind) {
    case 'help':
      console.log(USAGE);
      return 0;

    case 'version':
      console.log(version);
      return 0;

    case 'error':
      console.error(`✖ ${command.message}\n`);
      console.error(USAGE);
      return 2;

    case 'check':
      return runCheck(command.file, { json: command.json });

    case 'render':
      return runRender(command.file, { out: command.out, scale: command.scale, verify: command.verify });

    case 'frame':
      return runFrame(command.file, { out: command.out, time: command.time, scale: command.scale });

    case 'audio':
      return runAudio(command.file, { out: command.out, format: command.format, bitrate: command.bitrate });

    case 'preview': {
      const server = await startPreviewServer(command.file, {
        port: command.port,
        host: command.host,
        watch: command.watch,
      });
      console.log(`▸ sequio preview → ${server.url}`);
      console.log(`  serving ${command.file}${command.watch ? ' (watching for changes)' : ''}`);
      console.log('  press Ctrl-C to stop.');

      // Stay alive until interrupted; tear the server down cleanly on the way out.
      await new Promise<void>((resolveStop) => {
        const stop = (): void => {
          void server.close().finally(() => resolveStop());
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return 0;
    }
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('✖', err instanceof Error ? err.message : err);
    process.exit(1);
  });

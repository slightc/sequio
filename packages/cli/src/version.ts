/**
 * The CLI version, read from this package's `package.json` at runtime (so it's
 * always in sync with the manifest, no build-time codegen).
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const version = pkg.version;

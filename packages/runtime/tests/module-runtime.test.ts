import { describe, expect, it } from 'vitest';
import { ModuleResolutionError, ModuleRuntime } from '../src/module-runtime';
import { InMemoryFileSystem } from '../src/vfs';

function runtime(files: Record<string, string>, externals?: Record<string, unknown>): ModuleRuntime {
  return new ModuleRuntime({ fs: new InMemoryFileSystem(files), externals });
}

describe('ModuleRuntime resolution', () => {
  it('resolves a relative import with an inferred extension', () => {
    const rt = runtime({
      '/index.ts': `import { two } from './math';\nmodule.exports = { two };`,
      '/math.ts': `export const two = 2;`,
    });
    expect(rt.resolve('./math', '/')).toBe('/math.ts');
    expect((rt.run('/index.ts') as { two: number }).two).toBe(2);
  });

  it('resolves a directory to its index file', () => {
    const rt = runtime({
      '/index.ts': `export { name } from './lib';`,
      '/lib/index.ts': `export const name = 'lib';`,
    });
    expect(rt.resolve('./lib', '/')).toBe('/lib/index.ts');
    const exports = rt.run('/index.ts') as { name: string };
    expect(exports.name).toBe('lib');
  });

  it('walks parent directories with ..', () => {
    const rt = runtime({
      '/index.ts': `export { shared } from './feature/child';`,
      '/shared.ts': `export const shared = 'root';`,
      '/feature/child.ts': `export { shared } from '../shared';`,
    });
    const exports = rt.run('/index.ts') as { shared: string };
    expect(exports.shared).toBe('root');
  });

  it('returns injected externals for bare specifiers', () => {
    const api = { hello: () => 'hi' };
    const rt = runtime(
      { '/index.ts': `import { hello } from 'my-api';\nmodule.exports = hello();` },
      { 'my-api': api },
    );
    expect(rt.run('/index.ts')).toBe('hi');
  });

  it('throws a ModuleResolutionError for an unknown bare specifier', () => {
    const rt = runtime({ '/index.ts': `import 'nope';` });
    expect(() => rt.run('/index.ts')).toThrow(ModuleResolutionError);
  });

  it('throws a ModuleResolutionError for a missing relative file', () => {
    const rt = runtime({ '/index.ts': `import './gone';` });
    expect(() => rt.run('/index.ts')).toThrow(/Cannot resolve module '\.\/gone'/);
  });

  it('caches modules so a shared dependency runs once (singleton)', () => {
    const rt = runtime({
      '/index.ts': `import a from './a';\nimport b from './b';\nmodule.exports = a === b;`,
      '/a.ts': `import s from './state';\nexport default s;`,
      '/b.ts': `import s from './state';\nexport default s;`,
      '/state.ts': `export default { n: 0 };`,
    });
    expect(rt.run('/index.ts')).toBe(true);
  });

  it('supports import cycles via partial exports (CJS semantics)', () => {
    const rt = runtime({
      '/index.ts': `const { ping } = require('./a');\nmodule.exports = ping();`,
      '/a.ts': `const b = require('./b');\nexports.ping = () => 'a' + b.pong();`,
      '/b.ts': `const a = require('./a');\nexports.pong = () => 'b';\nexports.viaA = () => typeof a.ping;`,
    });
    expect(rt.run('/index.ts')).toBe('ab');
  });

  it('surfaces the failing module path when execution throws', () => {
    const rt = runtime({ '/index.ts': `throw new Error('boom');` });
    expect(() => rt.run('/index.ts')).toThrow(/index\.ts.*boom/s);
  });
});

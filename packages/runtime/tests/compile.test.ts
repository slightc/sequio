import { describe, expect, it } from 'vitest';
import { compileModule, langOf } from '../src/compile';

describe('langOf', () => {
  it('infers language from extension', () => {
    expect(langOf('/a.ts')).toBe('ts');
    expect(langOf('/a.tsx')).toBe('tsx');
    expect(langOf('/a.js')).toBe('js');
    expect(langOf('/a.jsx')).toBe('jsx');
    expect(langOf('/a.json')).toBe('json');
    expect(langOf('/a')).toBe('ts');
  });
});

describe('compileModule', () => {
  it('strips TypeScript types and lowers ESM to CommonJS', () => {
    const src = `
      interface Point { x: number; y: number }
      export const origin: Point = { x: 0, y: 0 };
      export function add(a: number, b: number): number { return a + b; }
    `;
    const { code } = compileModule(src, '/math.ts');
    // Types are gone; CJS exports are present.
    expect(code).not.toContain('interface');
    expect(code).not.toContain(': number');
    expect(code).toContain('exports');
    expect(code).toContain('origin');
    expect(code).toContain('add');
  });

  it('preserves import/require lowering for relative specifiers', () => {
    const { code } = compileModule(`import { add } from './math';\nexport const two = add(1, 1);`, '/index.ts');
    expect(code).toContain('require');
    expect(code).toContain('./math');
  });

  it('wraps a JSON module as a value export', () => {
    const { code } = compileModule('{"a": 1, "b": [2, 3]}', '/data.json');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const mod: { exports: unknown } = { exports: {} };
    new Function('module', code)(mod);
    expect(mod.exports).toEqual({ a: 1, b: [2, 3] });
  });

  it('throws on invalid JSON with the file name', () => {
    expect(() => compileModule('{not json}', '/bad.json')).toThrow(/bad\.json/);
  });

  it('reports syntactic diagnostics without throwing', () => {
    const { diagnostics } = compileModule('const x: = 1;', '/broken.ts');
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

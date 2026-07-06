/**
 * Transpile a single TS/JS source file to runnable CommonJS.
 *
 * The runtime links modules itself (see `module-runtime.ts`), so it needs each
 * file lowered to CommonJS (`require` / `module.exports`) rather than ESM. We use
 * the TypeScript compiler's `transpileModule`, which strips types **per file**
 * without type-checking or cross-file resolution — exactly the isolated,
 * fast transform this needs (and it runs unchanged in the browser: `typescript`
 * is pure JS). Type errors surface when the code actually runs, not here.
 */
import ts from 'typescript';

/** Which language a file is written in, inferred from its extension. */
export type SourceLang = 'ts' | 'tsx' | 'js' | 'jsx' | 'json';

/** Infer the language from a file path's extension (defaults to `ts`). */
export function langOf(path: string): SourceLang {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'js';
  return 'ts';
}

export interface CompileResult {
  /** The emitted CommonJS code. */
  code: string;
  /** Syntactic diagnostics as human-readable strings (empty when clean). */
  diagnostics: string[];
}

/**
 * Transpile `code` (a TS/JS source) to CommonJS. `.json` is wrapped as a module
 * exporting the parsed value. Throws on a hard parse failure with the file name.
 */
export function compileModule(code: string, fileName: string): CompileResult {
  const lang = langOf(fileName);

  if (lang === 'json') {
    // Validate + inline: a JSON module exports its parsed value.
    let value: unknown;
    try {
      value = JSON.parse(code);
    } catch (err) {
      throw new Error(`Failed to parse JSON module ${fileName}: ${(err as Error).message}`);
    }
    return { code: `module.exports = ${JSON.stringify(value)};`, diagnostics: [] };
  }

  const result = ts.transpileModule(code, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      // Keep the transform isolated & fast — no cross-file inference. Matches how
      // the linker treats each file independently.
      isolatedModules: true,
      jsx: lang === 'tsx' || lang === 'jsx' ? ts.JsxEmit.Preserve : ts.JsxEmit.None,
      // `require`/`module`/`exports` are provided by the linker's wrapper.
      allowJs: true,
    },
  });

  const diagnostics = (result.diagnostics ?? []).map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  );

  return { code: result.outputText, diagnostics };
}

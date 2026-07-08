import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// The skill package ships no runtime code, so its "tests" validate the docs it
// ships: the SKILL.md frontmatter is well-formed, and every relative link the
// skill or llms.txt points at (to a file on disk) actually resolves. Broken
// references are the only way this package can rot.

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = resolve(pkgRoot, 'skills/sequio');
const skillPath = resolve(skillDir, 'SKILL.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Extract the leading `--- ... ---` YAML frontmatter block, if any. */
function frontmatter(md: string): string | null {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(md);
  return match ? match[1] : null;
}

describe('sequio SKILL.md', () => {
  const md = read(skillPath);

  it('starts with a YAML frontmatter block', () => {
    expect(frontmatter(md)).not.toBeNull();
  });

  it('declares a valid lowercase-hyphen name', () => {
    const fm = frontmatter(md)!;
    const name = /(?:^|\n)name:\s*(\S+)/.exec(fm)?.[1];
    expect(name).toBe('sequio');
    // Agent-skill names are lowercase letters, digits and hyphens.
    expect(name!).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('has a non-empty description that says what it is for', () => {
    const fm = frontmatter(md)!;
    // description may be a folded (`>-`) multi-line scalar; grab everything after it.
    const desc = /description:\s*>-?\s*([\s\S]+?)(?:\n[a-z_]+:|\s*$)/.exec(fm)?.[1] ?? '';
    expect(desc.trim().length).toBeGreaterThan(40);
    expect(desc.toLowerCase()).toContain('sequio');
  });

  it('references its two reference files, and both exist', () => {
    expect(md).toContain('references/api.md');
    expect(md).toContain('references/recipes.md');
    expect(existsSync(resolve(skillDir, 'references/api.md'))).toBe(true);
    expect(existsSync(resolve(skillDir, 'references/recipes.md'))).toBe(true);
  });
});

describe('llms.txt', () => {
  const llmsPath = resolve(pkgRoot, 'llms.txt');
  const txt = read(llmsPath);

  it('exists and follows the llms.txt shape (H1 + summary blockquote)', () => {
    expect(txt.startsWith('# sequio')).toBe(true);
    expect(txt).toMatch(/\n> /); // at least one blockquote summary line
  });

  it('links only to https URLs (no dangling relative links)', () => {
    const links = [...txt.matchAll(/\]\((.*?)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const href of links) {
      expect(href).toMatch(/^https:\/\//);
    }
  });
});

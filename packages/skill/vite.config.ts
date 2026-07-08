import { defineConfig } from 'vite';

// Skill package. It ships no runtime code — just an Agent Skill (SKILL.md), its
// reference files, and an llms.txt. This config is only what vitest needs to run
// the pure-logic tests that validate the skill's frontmatter and that every
// intra-skill / llms.txt link resolves to a file on disk.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

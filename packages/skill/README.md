# `@sequio/skill`

An installable **AI Agent Skill** and an **`llms.txt`** that teach an AI assistant
how to use [sequio](https://github.com/slightc/sequio) — how to build a
`Track / Clip / Effect` object graph, animate it, and preview / export / render
video. Drop it into any project that consumes `@sequio/engine` so the assistant
working in that repo already knows the API and the mental model.

This package ships **no runtime code** — just docs an agent reads.

```
skills/sequio/
  SKILL.md              the skill (YAML frontmatter: name + description, then the guide)
  references/
    api.md              the full public surface, grouped by module
    recipes.md          copy-paste composition patterns
llms.txt                the llms.txt index (llmstxt.org) — links to the canonical docs
```

## What's inside

- **`SKILL.md`** — an [Agent Skill](https://docs.claude.com/en/docs/claude-code/skills):
  a Markdown file with `name` / `description` frontmatter that an AI agent
  auto-loads when a task involves sequio (composing video, timelines, `TextClip`,
  `Compositor`, rendering an MP4 from code, …). It links to the two reference
  files for the exact API and fuller examples.
- **`llms.txt`** — a root-level [`/llms.txt`](https://llmstxt.org/) index: a short
  project summary plus curated links to sequio's docs, reference, and examples, so
  any LLM tool (not just Claude) can discover the canonical material.

## Install the skill into your project

Agent Skills live under `.claude/skills/<name>/`. Copy this package's `skills/`
folder there:

```bash
# from your project root, after `npm install @sequio/skill` (or pnpm/yarn)
mkdir -p .claude/skills
cp -R node_modules/@sequio/skill/skills/sequio .claude/skills/sequio
```

Or symlink it so it tracks the installed version:

```bash
ln -s ../../node_modules/@sequio/skill/skills/sequio .claude/skills/sequio
```

Commit `.claude/skills/sequio/` and every agent working in the repo picks it up.
The skill is host-agnostic Markdown — any tool that reads Agent Skills can use it.

## Serve the `llms.txt`

If your project (or sequio's) has a website, publish `llms.txt` at the site root
so it is reachable at `https://your-site/llms.txt` — the convention LLM tools look
for. The file also stands alone as a compact, link-first briefing you can paste
into any assistant.

```bash
cp node_modules/@sequio/skill/llms.txt public/llms.txt   # e.g. for a Vite/Next site
```

## Keeping it accurate

The skill's source of truth is the engine barrel
(`packages/engine/src/index.ts`). When the public API changes, update
`references/api.md` (and `SKILL.md` if the mental model shifts) in the same
change — the package's tests assert the frontmatter is well-formed and that every
intra-skill and `llms.txt` on-disk link still resolves.

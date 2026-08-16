# Anas Malas — Hardware Engineer

This is a small, static Eleventy site for engineering notes, teardown reports, and hardware projects. It ships plain HTML, CSS, a tiny theme switcher, and no analytics.

## Preview it locally

1. Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/).
2. Double-click `preview.cmd`.
3. The first run installs the site tools. Later runs open the live preview at `http://localhost:8080/`.

The preview watches the source files and refreshes when they change. The public site does not include the editor or build dependencies.

## Write a note

Create a Markdown file in `src/notes/` with this front matter:

```yaml
---
layout: layouts/note.njk
title: A useful, specific title
description: One sentence that tells a reader what they will learn.
date: 2026-08-16
tags:
  - PCB design
readTime: 4
permalink: /notes/a-useful-specific-title/
---
```

Write the evidence first: what you observed, what you expected, what changed, and what remains uncertain. Put photos or diagrams in `src/assets/` and reference them with an absolute `/assets/...` path.

## Build and deploy

The GitHub Actions workflow installs the pinned pnpm lockfile, builds `_site`, and deploys it to GitHub Pages on pushes to `main`. The `CNAME` file is copied from `src/CNAME` so the custom domain survives every build.

For a local production build:

```text
pnpm install --frozen-lockfile
pnpm run build
```

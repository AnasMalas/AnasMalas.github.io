# Anas Malas — Hardware Engineer

This is a small, static Eleventy site for engineering notes, teardown reports, and hardware projects. It ships plain HTML, CSS, a tiny theme switcher, and no analytics.

## Preview it locally

1. Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/).
2. Double-click `preview.cmd`.
3. The first run installs the site tools. Later runs open the live preview at `http://localhost:8080/`.

The preview watches the source files and refreshes when they change. The public site does not include build dependencies.

## Edit and publish with Studio

Double-click `studio.cmd`. The Studio builds the site and opens at `http://127.0.0.1:4173/studio/`.

1. Pick any article, project, open-source page, or editable site page in the left sidebar.
2. Turn the four previews on or off. They are arranged as desktop light / mobile light, then desktop dark / mobile dark. Desktop previews can switch between 1440×900 (16:10) and 1440×810 (16:9); phones stay at 390×844. Every screen keeps its exact ratio and uses blank space around it when needed, so all four fit without scrolling. A single desktop preview fills the preview wall. When one desktop and one phone are visible, the desktop uses the remaining width until it fills the available height.
3. Every image post shows four control cards at once: full-page desktop, full-page mobile, shared-card desktop, and shared-card mobile. Title placement is independent in all four. Shared cards also have a draggable crop box, zoom control, 16:9 or 4:3 frame, and blank or sampled-color overflow. **Open large** brings the same crop tool into a near-full-screen workspace; **Reset crop** restores its scenario default. Position snaps to center, zoom snaps to 100%, and arrow keys provide precise movement. Expanded images always return to their natural ratio. **Opens** controls whether the shared card starts collapsed or expanded.
4. Click **Edit** and write directly on the real page. You can also open Home, Projects, or Open source and click a tile to edit it in place. The formatting toolbar adds headings, lists, links, and inline images. **Details** changes the date, lead image, image description, repository, and related-page link. Hover an item in the left sidebar and use its arrow buttons to move it earlier or later in its section; `Alt+Up` and `Alt+Down` do the same for the selected item.
5. Click **Save changes**. Studio writes the edit into `src/_data/studioContent.json`, copies uploaded images into `src/assets/images/posts/`, rebuilds the site, and refreshes every preview.
6. Click **Publish**, then **Publish now**. Studio runs the production build, commits the saved site files, and pushes the result to `main`. The existing GitHub Pages workflow updates `anasmalas.com`.

Studio listens only on this computer and uses the Git credentials already configured for this repository. It does not store a GitHub password or token. Keep its command window open while editing.

The older article canvas remains available at `http://localhost:8080/editor/` when using `preview.cmd`; Studio is the faster workflow for editing and publishing the actual site.

The imported reading pages use two data files:

- `src/_data/linkedin.js` contains the original post wording.
- `src/_data/presentation.js` controls dates, section placement, display titles, images, repository links, and related-page links.

Page copy and special routes live in their matching templates, such as `src/about.njk`, `src/bc2.njk`, and `src/bc2-console.njk`.

Put images and downloadable files under `src/assets/`. They are copied into the built site and hosted by GitHub Pages. Reference them with a root-relative path such as `/assets/images/posts/my-article/photo.jpg`; no external image host is needed.

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

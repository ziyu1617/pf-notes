# Smart Notes website

Static Chinese product site. Preview with `python3 -m http.server 8020 --directory website/dist` from the repository root.

- `dist/index.html`, `style.css`, and `app.js`: responsive presentation and local-only interactive samples.
- `dist/downloads.json`: verified Apple Silicon release download. Only enable assets after a successful native build and smoke test.
- `dist/assets/journal-collage.webp`: current hero artwork, adapted from the owner's reference with built-in image generation.
- `.openai/hosting.json`: Sites project identity and static output configuration.

The app preview scales a 1200 × 800 canvas without changing its aspect ratio. It contains synthetic example entries and never reads or writes the desktop application's data.

The current release is an Apple Silicon technical preview, with no Developer ID signing or Apple notarization. Intel Mac and Windows downloads are intentionally excluded pending owner validation.

## GitHub Pages

Public website: https://ziyu1617.github.io/pf-notes/

Publish only the contents of `dist` to the root of the `gh-pages` branch. GitHub Pages serves that branch directly, with `.nojekyll` disabling Jekyll processing. No build step, account login, or environment variables are required. Relative asset URLs support the `/pf-notes/` project path.

For updates, copy the current `dist` contents into a checkout of `gh-pages`, commit, and push. Keep the existing branch history. Do not publish the desktop application's data, repository metadata, or local hosting credentials. After deployment, check the public page and Mac download without signing in.

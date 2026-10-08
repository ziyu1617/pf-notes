# Smart Notes website

Static Chinese product site. Preview with `python3 -m http.server 8020 --directory website/dist` from the repository root.

- `dist/index.html`, `style.css`, and `app.js`: responsive presentation and local-only interactive samples.
- `dist/downloads.json`: verified Apple Silicon release download. Only enable assets after a successful native build and smoke test.
- `dist/assets/journal-collage.webp`: current hero artwork, adapted from the owner's reference with built-in image generation.
- `.openai/hosting.json`: Sites project identity and static output configuration.

The app preview scales a 1200 × 800 canvas without changing its aspect ratio. It contains synthetic example entries and never reads or writes the desktop application's data.

The current release is an Apple Silicon technical preview, with no Developer ID signing or Apple notarization. Intel Mac and Windows downloads are intentionally excluded pending owner validation.

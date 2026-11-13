# Design — "Geological permanence"

A showcase surface for the Crypto Inheritance Vault, built with `/surprise-me`.
Zero-build: it runs from any static server.

```bash
cd design && python3 -m http.server 4321
```

`CONTRACT.md` is the locked brief. It was produced by a real dice roll, not by
picking a favourite — the whole point of the skill is that the model does not
get to choose the lane. The roll landed on direction #5 of 7 and paired it with
a bioluminescent teal palette, which reads as the abyssal sea floor: sediment
laid down under pressure, untouched by the surface, lit only by something alive.

## What is real here

| Asset | How |
|---|---|
| Descent frame sequence | 90 frames rendered by `tools/render_descent.py` — fractal-noise bedding, tilt that steepens with depth, three parallax layers of marine snow, bioluminescence with per-point flicker |
| Grain | Generated client-side (`makeGrain()` in `main.js`), composited once over the stage |
| Type | Archivo Variable + JetBrains Mono, self-hosted, driven on the `wght`/`wdth` axes |

Higgsfield was unavailable (0 credits, free plan), so the imagery is rendered
rather than generated. For strata that is arguably the better tool: real
sedimentation *is* a noise-driven process, so it can be simulated honestly
instead of prompted for.

## Re-rendering

```bash
python3 tools/render_descent.py
```

`FRAMES`, `ONLY`, `QUALITY` and `BAKE_GRAIN` are environment overrides;
`ONLY=0,45,89` renders a few keyframes at full core geometry for fast iteration.

## Weight

1.1 MB total, 982 KB of it the frame sequence. It was 3.9 MB until the grain
came out of the frames: high-frequency noise is exactly what a lossy codec
spends its bits on, and baking it in stored the same statistical texture ninety
times. Measured FCP 136 ms, 57 fps during the scrub, zero long tasks.


---

## Published to GitHub Pages

`.github/workflows/pages.yml` publishes **this directory only** to
<https://marcusg999.github.io/cryptolegacy/> on pushes to `main` that touch
`design/`.

The workflow stages the artifact file by file rather than uploading the repo,
so nothing reaches the public URL unless it is named there, and it asserts that
`tools/` and `CONTRACT.md` did not come along. It also greps the staged
`index.html` for absolute paths, because a project site is served from
`/<repo>/` and an absolute `src="/…"` would 404 in production while working
perfectly on a local server.

### Why the application is not served here

Pages is static hosting, and the app needs a server for middleware, five route
handlers and six server components that read cookies. A static export fails on
the first of those.

The disqualifying reason is smaller and harder: **Pages cannot send HTTP
response headers.** That removes the Content-Security-Policy, HSTS,
`Permissions-Policy` and `Cross-Origin-Opener-Policy` the app sets, and a
per-request CSP nonce is impossible in principle without a per-request server.
`frame-ancestors` cannot be set from a `<meta>` tag at all, so clickjacking
protection would simply be absent.

Spec §11 requires a strict CSP on every page that touches decrypted content. A
zero-knowledge vault served without one is not the product.

### What this page gets instead

A `<meta http-equiv="Content-Security-Policy">`, which is what static hosting
allows: `default-src 'self'`, no off-origin anything, `connect-src 'none'`
(the page makes no fetch or XHR — the frame sequence loads through `Image()`),
`object-src 'none'` and `base-uri 'none'`.

Verified enforced rather than merely present: an off-origin `fetch()` from the
page is refused by `connect-src 'none'`. `style-src` keeps `'unsafe-inline'`
for the 53 inline style attributes that carry the tilt and reveal values, and
`img-src` keeps `data:` for the runtime grain plate.

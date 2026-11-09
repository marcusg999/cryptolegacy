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

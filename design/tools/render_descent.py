#!/usr/bin/env python3
"""
Renders the abyssal descent frame sequence for the scroll-scrub motion signature.

Why this exists rather than a CSS gradient: the contract's motion signature is a
real scrubbed image sequence, and sediment is a noise-driven depositional process
— so the honest way to draw strata is to simulate the deposition, not to fake
depth with box-shadows.

What a frame contains, in draw order:
  1. Sediment column   — fractal-noise bedding, laterally perturbed, sheared by a
                         tilt that INCREASES with depth (the contract's rule: the
                         page deforms under pressure as you descend).
  2. Extinction        — sunlight falls off with depth. By the bottom the only
                         light in frame is biological.
  3. Marine snow       — three parallax layers of particulate, drifting per frame,
                         so the sequence is a real descent and not a pan.
  4. Bioluminescence   — additive radial glow with per-point flicker.
  5. Grain + vignette  — sensor character, stronger where the image is darkest.

Output: assets/frames/descent_####.webp
"""
import math
import os
import sys

import numpy as np
from PIL import Image

# --- contract palette (sRGB 0-255) ------------------------------------------
ABYSS   = np.array([0x04, 0x07, 0x0C], dtype=np.float32)
BEDS    = [np.array(c, dtype=np.float32) for c in (
    (0x06, 0x0C, 0x15),   # dark mudstone
    (0x12, 0x22, 0x33),
    (0x1E, 0x35, 0x48),
    (0x2C, 0x4A, 0x5E),   # pale silt band — the light beds that make bedding read
    (0x0B, 0x16, 0x24),
)]
GLOW    = np.array([0x2B, 0xF5, 0xD0], dtype=np.float32)
CYAN    = np.array([0x4F, 0xC8, 0xFF], dtype=np.float32)

W, H       = 1280, 720
FRAMES     = int(os.environ.get("FRAMES", 90))
ONLY       = {int(i) for i in os.environ["ONLY"].split(",")} if os.environ.get("ONLY") else None
BAKE_GRAIN = os.environ.get("BAKE_GRAIN", "0") == "1"
QUALITY    = int(os.environ.get("QUALITY", 72))
STEP       = 84                      # core px advanced per frame
MARGIN     = 160                     # lateral room for parallax drift
CORE_W     = W + 2 * MARGIN
CORE_H     = FRAMES * STEP + H


def value_noise_1d(n, cells, rng):
    """Smooth 1-D value noise, cosine-interpolated."""
    pts = rng.random(cells + 2).astype(np.float32)
    x = np.linspace(0, cells, n, endpoint=False).astype(np.float32)
    i = x.astype(np.int32)
    t = x - i
    t = (1 - np.cos(t * math.pi)) * 0.5          # cosine ease
    return pts[i] * (1 - t) + pts[i + 1] * t


def fbm_1d(n, cells, octaves, rng, gain=0.5, lac=2.0):
    out = np.zeros(n, dtype=np.float32)
    amp, c, norm = 1.0, cells, 0.0
    for _ in range(octaves):
        out += amp * value_noise_1d(n, int(c), rng)
        norm += amp
        amp *= gain
        c *= lac
    return out / norm


def value_noise_2d(h, w, cells_y, cells_x, rng, oy=0.0, ox=0.0):
    # Offsets are applied in COORDINATE space, not by rolling the output array.
    # Rolling wraps the lattice and leaves a hard seam down the image — which is
    # what put a vertical step through the bedding on the first attempt.
    g = rng.random((cells_y + 4, cells_x + 4)).astype(np.float32)
    yi = (np.linspace(0, cells_y, h, endpoint=False) + oy).astype(np.float32)
    xi = (np.linspace(0, cells_x, w, endpoint=False) + ox).astype(np.float32)
    y0, x0 = yi.astype(np.int32), xi.astype(np.int32)
    ty = ((1 - np.cos((yi - y0) * math.pi)) * 0.5)[:, None]
    tx = ((1 - np.cos((xi - x0) * math.pi)) * 0.5)[None, :]
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]
    d = g[np.ix_(y0 + 1, x0 + 1)]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm_2d(h, w, cy, cx, octaves, rng, gain=0.5, lac=2.13):
    out = np.zeros((h, w), dtype=np.float32)
    amp, norm, fy, fx = 1.0, 0.0, float(cy), float(cx)
    for _ in range(octaves):
        out += amp * value_noise_2d(
            h, w, max(int(fy), 1), max(int(fx), 1), rng,
            oy=float(rng.random()) * 2.0, ox=float(rng.random()) * 2.0,
        )
        norm += amp
        amp *= gain
        fy *= lac
        fx *= lac
    return out / norm


def grain_field(h, w, sigma, rng):
    """Blurred white noise. Used instead of value noise wherever the result is
    meant to read as grain, because value noise leaves a lattice and grain
    must not."""
    f = rng.normal(0.0, 1.0, (h, w)).astype(np.float32)
    k = max(int(sigma), 1)
    pad = np.pad(f, ((k, k), (k, k)), mode="reflect")
    acc = np.zeros_like(f)
    for dy in range(-k, k + 1):
        for dx in range(-k, k + 1):
            acc += pad[k + dy:k + dy + h, k + dx:k + dx + w]
    return acc / ((2 * k + 1) ** 2)


def build_core(rng):
    """The tall sediment column every frame is a window onto."""
    print(f"  deposition: {CORE_W}x{CORE_H}", flush=True)

    # Bedding: a 1-D fractal profile over depth selects bed identity. Low octaves
    # give thick beds, high octaves the fine laminations between them.
    bed_profile = fbm_1d(CORE_H, 26, 6, rng)
    lamination  = fbm_1d(CORE_H, 420, 3, rng)

    # Tilt grows with depth: ~2deg at the surface to ~7deg at the bottom.
    depth_t = np.linspace(0.0, 1.0, CORE_H, dtype=np.float32)
    tilt_deg = 3.0 + 9.0 * depth_t        # visible, and steepening with depth
    slope = np.tan(np.radians(tilt_deg))                       # px of rise per px of run

    xs = (np.arange(CORE_W, dtype=np.float32) - CORE_W / 2)
    # Sample the bed profile at a sheared depth, so beds slope and the slope steepens.
    sheared = np.arange(CORE_H, dtype=np.float32)[:, None] + xs[None, :] * slope[:, None]

    # Lateral boundary perturbation — real beds are not ruled lines. Amplitude
    # grows with depth (more deformation under load).
    warp = (fbm_2d(CORE_H, CORE_W, 5, 7, 4, rng) - 0.5) * (18 + 70 * depth_t[:, None])
    # Bilinear, not nearest. Rounding the lookup to an integer row quantises the
    # warp into visible stair-steps wherever its amplitude is large — which is
    # exactly where the deformation is supposed to look most fluid.
    sample = np.clip(sheared + warp, 0, CORE_H - 1.001)
    s0 = sample.astype(np.int32)
    sf = (sample - s0).astype(np.float32)
    s1 = np.minimum(s0 + 1, CORE_H - 1)

    bed = bed_profile[s0] * (1.0 - sf) + bed_profile[s1] * sf
    lam = lamination[s0] * (1.0 - sf) + lamination[s1] * sf

    # Quantise into discrete beds with UNEVEN thresholds, so some units are
    # thick and massive and others are thin — uniform thresholds read as a
    # repeating pattern rather than a stratigraphic sequence.
    thresholds = np.array([0.0, 0.20, 0.34, 0.56, 0.78, 1.01], dtype=np.float32)
    idx = np.zeros_like(bed, dtype=np.int32)
    for k in range(len(BEDS)):
        idx[(bed >= thresholds[k]) & (bed < thresholds[k + 1])] = k
    img   = np.zeros((CORE_H, CORE_W, 3), dtype=np.float32)
    for k, col in enumerate(BEDS):
        m = (idx == k)
        img[m] = col
    img *= (0.62 + 0.78 * lam)[..., None]                       # lamination contrast

    # Raking light. Real bedding reads because light crosses it at an angle and
    # each boundary throws a line of relief; without this the beds are scratches.
    relief = np.zeros_like(bed)
    relief[1:, :] = bed[1:, :] - bed[:-1, :]
    relief = np.clip(relief * 26.0, -1.0, 1.0)
    img += relief[..., None] * np.array([34.0, 52.0, 64.0], np.float32)

    # Grain size varies by bed: coarser beds get more speckle.
    speckle = grain_field(CORE_H, CORE_W, 1, rng)
    img += (speckle * 17.0 * (0.4 + bed))[..., None]

    # A single unconformity — one sharp truncation surface, the geological
    # signature of a long gap in the record. Visually it is the page's one
    # hard horizontal break.
    unc = int(CORE_H * 0.62)
    band = slice(unc, min(unc + 3, CORE_H))
    img[band] = np.clip(img[band] * 0.25 + GLOW * 0.10, 0, 255)

    return img


def main():
    rng = np.random.default_rng(20261109)
    core = build_core(rng)

    # Bioluminescent points, denser with depth (chemosynthesis, not sunlight).
    n_pts = max(8, int(CORE_H / 1000 * 5.5))          # ~5 per 1000px of column
    p_depth = rng.random(n_pts) ** 0.55
    py = (p_depth * (CORE_H - 1)).astype(np.float32)
    px = rng.random(n_pts).astype(np.float32) * CORE_W
    p_rad = 9 + rng.random(n_pts).astype(np.float32) ** 2 * 42
    p_amp = 0.10 + rng.random(n_pts).astype(np.float32) * 0.34
    p_phase = rng.random(n_pts).astype(np.float32) * math.tau
    p_cyan = rng.random(n_pts) < 0.3

    # Three parallax layers of marine snow.
    snow = []
    for layer, (count, size, par, bright) in enumerate(
        ((760, 1.0, 1.0, 0.16), (320, 1.8, 1.5, 0.28), (110, 2.9, 2.3, 0.46))
    ):
        snow.append(dict(
            x=rng.random(count).astype(np.float32) * CORE_W,
            y=rng.random(count).astype(np.float32) * CORE_H,
            size=size, par=par, bright=bright,
            drift=(rng.random(count).astype(np.float32) - 0.5) * 2.2,
        ))

    yy = np.arange(H, dtype=np.float32)[:, None]
    xx = np.arange(W, dtype=np.float32)[None, :]

    # Vignette, computed once.
    nx = (xx - W / 2) / (W / 2)
    ny = (yy - H / 2) / (H / 2)
    vign = np.clip(1.0 - 0.52 * (nx ** 2 + ny ** 2) ** 1.15, 0.0, 1.0).astype(np.float32)

    out_dir = "assets/frames"
    os.makedirs(out_dir, exist_ok=True)

    written = 0
    for f in range(FRAMES):
        if ONLY is not None and f not in ONLY:
            continue
        t = f / max(FRAMES - 1, 1)
        top = int(t * (CORE_H - H - 1))

        # Lateral drift: the column slides sideways as we fall, so the sequence
        # reads as motion through water rather than a vertical pan.
        drift = int(math.sin(t * math.pi * 1.15) * MARGIN * 0.80)
        x0 = MARGIN + drift
        frame = core[top:top + H, x0:x0 + W].copy()

        # Extinction: surface light dies off; by the floor only biology glows.
        light = float(np.clip(1.08 - 1.22 * t, 0.05, 1.0))
        cold = np.clip(1.0 - (yy / H) * 0.55, 0, 1)
        frame *= (0.38 + 0.62 * light * cold)[..., None]

        # Marine snow.
        for lay in snow:
            sy = (lay["y"] - top * lay["par"]) % CORE_H
            sx = (lay["x"] - x0 + lay["drift"] * f) % CORE_W
            vis = (sy < H) & (sx < W)
            if not vis.any():
                continue
            iy = sy[vis].astype(np.int32)
            ix = sx[vis].astype(np.int32)
            s = lay["size"]
            b = lay["bright"] * (0.35 + 0.65 * light) * 150
            r = int(max(1, round(s)))
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    d2 = dx * dx + dy * dy
                    if d2 > r * r:
                        continue
                    fall = math.exp(-d2 / max(s * s, 0.6))
                    Y = np.clip(iy + dy, 0, H - 1)
                    X = np.clip(ix + dx, 0, W - 1)
                    frame[Y, X] += (np.array([0.80, 0.93, 1.0], np.float32) * b * fall)

        # Bioluminescence — additive, flickering, the only light down here.
        rel = py - top
        near = np.where((rel > -260) & (rel < H + 260))[0]
        for i in near:
            cy = float(rel[i])
            cx = float(px[i] - x0)
            if cx < -260 or cx > W + 260:
                continue
            rad = float(p_rad[i])
            flick = 0.70 + 0.30 * math.sin(t * 9.0 + float(p_phase[i]))
            amp = float(p_amp[i]) * flick * (0.45 + 0.85 * t)   # brighter as we descend
            d2 = (xx - cx) ** 2 + (yy - cy) ** 2
            g = np.exp(-d2 / (2 * rad * rad)).astype(np.float32)
            colour = CYAN if p_cyan[i] else GLOW
            frame += g[..., None] * colour * amp
            # A hard small core to the glow, so it reads as a point source with a
            # halo rather than a soft blob.
            core_pt = np.exp(-d2 / (2 * (rad * 0.10) ** 2)).astype(np.float32)
            frame += core_pt[..., None] * colour * amp * 2.6

        frame *= vign[..., None]
        # Lift toward the abyss colour rather than toward grey, and pull the
        # black point down so the midtones stop looking murky.
        frame = np.clip(frame, 0, None)
        frame = (frame / 255.0) ** 1.14 * 255.0
        frame += ABYSS * 0.62

        # Sensor grain is NOT baked in. High-frequency noise is what WebP
        # spends its bits on — it was costing ~30 KB per frame, 2.7 MB across
        # the sequence, to store the same statistical texture ninety times.
        # It is composited once at runtime from a single tiling plate instead,
        # which also keeps it crisp at 1:1 instead of scaling with the frame.
        if BAKE_GRAIN:
            g = rng.normal(0.0, 1.0, (H, W, 1)).astype(np.float32)
            lum = frame.mean(axis=2, keepdims=True) / 255.0
            frame += g * (3.8 - 2.4 * np.clip(lum, 0, 1))

        img = Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8), "RGB")
        img.save(f"{out_dir}/descent_{f:04d}.webp", "WEBP", quality=QUALITY, method=6)
        written += 1
        if f % 15 == 0:
            print(f"  frame {f + 1}/{FRAMES}", flush=True)

    files = [n for n in os.listdir(out_dir) if n.endswith(".webp")]
    total = sum(os.path.getsize(f"{out_dir}/{n}") for n in files)
    print(f"done: wrote {written} frame(s); {len(files)} on disk, "
          f"{total / 1e6:.1f} MB total, {total / max(len(files),1) / 1024:.0f} KB average")


if __name__ == "__main__":
    sys.exit(main())

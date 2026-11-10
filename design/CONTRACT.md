# CONTRACT — Crypto Inheritance Vault — "Geological permanence" (abyssal strata)

Rolled, not chosen. Seed `1794238817473881012`, direction #5 of 7.
Once written this does not move; the audit judges the render against it.

```
Feeling in one line : Standing at the bottom of deep water, looking at layers that
                      will outlast everyone in the room — and seeing one faint living
                      light marking where something was left for you.

Palette             : bg      #04070C   abyss
                      strata  #0A1320 / #0F1E2E / #152838   sediment bands
                      ink     #DDE9F1   pale silt
                      muted   #65809A
                      glow    #2BF5D0   bioluminescence (primary accent)
                      cyan    #4FC8FF   secondary accent
                      paper   #E9DFCB   the ONE warm tone, reserved exclusively for
                                        the physical-paper channel. Declared here so
                                        it is contract, not drift.

Type                : Display — Archivo Variable (wght 100–900, wdth 62–125), self-hosted.
                      Mono    — JetBrains Mono, captions and data only.
                      Rule    — extreme scale contrast: display never below 4rem,
                      mono never above 0.8rem. Nothing in between. No mid-size text.

Layout              : Tilted strata. A rotated grid on a -5.2deg axis — geologically a
                      tectonic unconformity, and the roll's diagonal system. Rule that
                      makes it unusual: the tilt INCREASES with depth (-2deg at the
                      surface, -7deg at the deepest layer), so the page itself deforms
                      under pressure as you descend.

Techniques (3)      : 1. Kinetic variable typography — Archivo's wdth + wght axes driven
                         by scroll velocity and pointer proximity. Letterforms COMPRESS
                         as you descend, as sediment does under load.
                      2. Scroll choreography — a pinned core-sample descent; each stratum
                         stages in as it passes the read-line.
                      3. Magnetic / warping cursor — a dive-light. Bioluminescence leans
                         toward the pointer; strata parallax away from it.

Motion signature    : Scroll-scrub image sequence (scroll-cinematic pipeline) — the
                      descent through the water column is a real frame sequence scrubbed
                      on canvas by scroll position, not a CSS animation.

Assets              : Real, generated. Abyssal descent still + animated clip (Higgsfield),
                      extracted to a frame sequence with ffmpeg. Self-hosted variable font.
                      No CSS gradient standing in for imagery.

One unmistakable moment:
                      The descent bottoms out. Pressure has squeezed the display type to
                      its narrowest width. Then the handwritten passphrase sheet — the
                      only warm object on the entire page — rises out of the black,
                      unrotated and perfectly level, the one thing the pressure did not
                      deform. The product's whole thesis in one image: the paper is what
                      survives.

Out of scope        : No WebGL/Three.js (not in the roll). No particle field. No shader
                      noise layer. No purple-blue gradient. No centred hero + three cards.
                      No emoji. No pricing table. No mid-weight body text.
```

## Audit bar

Primary: **linear.app** — the canonical best-in-class dark product page, fetchable,
judged blind desktop + mobile.
Measurable half: Lighthouse performance and first contentful paint, stated alongside.

Exit condition: beats the bar in a blind comparison, and never before 3 passes.

---

## Audit record

Six screenshot → critique → improve passes (the skill requires at least three).
What each pass caught:

1. **Bioluminescence blew out to nebula bokeh** and the geology was invisible —
   the exact AI-default anti-pattern. Palette widened, glow made sparse and small.
2. **The hero was empty on load.** The easing started the headline at opacity 0,
   so a first-time visitor saw a texture with no words on it. Mobile also had
   horizontal overflow; rotation is now removed below 820px rather than scaled.
3. **No tilt rendered at all** — the reveal animation's `transform` silently
   clobbered `.tilted`'s rotation. Reveals now animate `translate`, which
   composes instead of overwriting. The floor heading was also cut off the left
   edge by a centring transform left behind in JS.
4. **The climax had no subject.** Added the sonar contact — the dive light
   finding what was left.
5. **3.9 MB of transfer.** Grain taken out of the frames and generated at
   runtime: 3.75 MB → 982 KB, with no visible loss.
6. **Grain layer cost 7 fps** at 4× viewport area; trimmed to `inset: 0`.
   Mobile clipped the twelfth word of the passphrase sheet — two columns now.

## The blind comparison could not be run

The contract named `linear.app` as the bar. Every design reference site is
blocked by this sandbox's egress proxy — linear.app, vercel.com, stripe.com,
apple.com and awwwards.com all fail with `ERR_TUNNEL_CONNECTION_FAILED`.

Rather than invent a comparison and approve the work against it — the failure
mode the skill explicitly warns about — the visual half of the audit is recorded
as **not run**, and the measurable half was substituted:

| Measure | Result |
|---|---|
| First contentful paint | 136 ms |
| Fully loaded | 682 ms |
| Transfer | 1 138 KB |
| FPS during scrub | 57 |
| Long tasks | 0 |
| Contrast (ink / body / mono / glow on abyss) | 16.3 / 14.7 / 4.9 / 14.5 — all pass AA |
| Reduced motion | 0 hidden elements, hero present |
| Mobile horizontal overflow | none |

Anti-pattern list (library.md §5), audited explicitly: no centred hero with
three cards; no purple-blue or teal-orange gradient applied to everything; no
emoji iconography; three integrated techniques rather than one effect on a plain
page; real rendered imagery rather than box-shadow depth; section rhythm varies
by design (the pinned descent, then four bands of different height and tilt);
copy is specific — "a house fire plus one cooperative relative", not "elevate
your experience".

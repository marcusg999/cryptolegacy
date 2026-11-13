'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The scrubbed descent. The landing page's argument, and nowhere else.
 *
 * Three techniques from design/CONTRACT.md are woven here: a scrubbed frame
 * sequence driven by scroll, kinetic variable typography that compresses under
 * depth, and a magnetic dive light the strata parallax away from.
 *
 * Why this is a client component and why it is only on `/`: the frame sequence
 * is ~1 MB. Mounting it on a product surface would spend that budget on a user
 * who came to check a custody point. It is also entirely decorative, so it is
 * aria-hidden and every word it displays is real DOM text beside it.
 */

/* A media query is an external store, so it is read as one. Mirroring it into
   state from an effect causes a cascading render and is what React's own
   lint rule objects to. This also gets the server render right: `false` on the
   server matches the markup the client produces before the query resolves. */
function subscribeReducedMotion(cb: () => void) {
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

const FRAME_COUNT = 90;
const frameUrl = (i: number) => `/descent/descent_${String(i).padStart(4, '0')}.webp`;

export interface Stratum {
  /** Fraction of the descent where this caption owns the screen. */
  readonly window: readonly [number, number];
  readonly depth: string;
  readonly body: React.ReactNode;
  readonly align?: 'left' | 'right';
}

export function Descent({
  hero,
  strata,
  floor,
}: {
  hero: React.ReactNode;
  strata: readonly Stratum[];
  floor: React.ReactNode;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const lightRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const frames = useRef<HTMLImageElement[]>([]);
  const ready = useRef(0);
  const current = useRef(-1);
  const [progress, setProgress] = useState(0);
  const reduced = useReducedMotion();

  /* Draw the requested frame, or the nearest decoded neighbour. Bailing out
     when a frame has not arrived leaves whatever was drawn last on screen,
     which early in the page's life can be a frame from a completely different
     depth — the descent appears to stall, then jump. */
  const draw = useCallback((i: number) => {
    if (ready.current === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let use = -1;
    for (let d = 0; d < FRAME_COUNT; d += 1) {
      const lo = i - d, hi = i + d;
      const okLo = lo >= 0 && frames.current[lo]?.complete && frames.current[lo]?.naturalWidth;
      if (okLo) { use = lo; break; }
      const okHi = hi < FRAME_COUNT && frames.current[hi]?.complete && frames.current[hi]?.naturalWidth;
      if (okHi) { use = hi; break; }
    }
    if (use < 0 || use === current.current) return;
    current.current = use;
    canvas.getContext('2d')?.drawImage(frames.current[use] as HTMLImageElement, 0, 0, canvas.width, canvas.height);
  }, []);

  const onScroll = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    const span = el.offsetHeight - window.innerHeight;
    const p = span > 0 ? Math.min(Math.max(-el.getBoundingClientRect().top / span, 0), 1) : 0;
    setProgress(p);
    draw(Math.round(p * (FRAME_COUNT - 1)));

    /* Kinetic type: Archivo's width axis runs 62–125, and pressure squeezes
       the hero toward the narrow end as you descend — which is what sediment
       does, and what the contract asks the type to say. */
    const h = heroRef.current;
    if (h) {
      h.style.fontVariationSettings = `'wght' ${(760 - p * 220).toFixed(0)}, 'wdth' ${(116 - p * 48).toFixed(0)}`;
      h.style.letterSpacing = `${(-0.035 - p * 0.012).toFixed(4)}em`;
    }
  }, [draw]);

  useEffect(() => {
    frames.current = new Array(FRAME_COUNT);
    for (let i = 0; i < FRAME_COUNT; i += 1) {
      const img = new Image();
      img.decoding = 'async';
      img.src = frameUrl(i);
      img.onload = () => {
        ready.current += 1;
        if (ready.current < FRAME_COUNT) { current.current = -1; onScroll(); }
      };
      frames.current[i] = img;
    }
    onScroll();
    let ticking = false;
    const handler = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { onScroll(); ticking = false; });
    };
    addEventListener('scroll', handler, { passive: true });
    addEventListener('resize', handler, { passive: true });
    return () => { removeEventListener('scroll', handler); removeEventListener('resize', handler); };
  }, [onScroll]);

  /* The dive light. Lags the pointer, because water resists. */
  useEffect(() => {
    if (reduced || matchMedia('(pointer: coarse)').matches) return;
    let px = innerWidth / 2, py = innerHeight / 2, lx = px, ly = py, raf = 0;
    const move = (e: PointerEvent) => { px = e.clientX; py = e.clientY; };
    addEventListener('pointermove', move, { passive: true });
    const loop = () => {
      lx += (px - lx) * 0.085;
      ly += (py - ly) * 0.085;
      if (lightRef.current) lightRef.current.style.transform = `translate3d(${lx}px,${ly}px,0)`;
      if (coreRef.current) coreRef.current.style.transform = `translate3d(${px}px,${py}px,0)`;
      if (canvasRef.current) {
        const dx = lx / innerWidth - 0.5, dy = ly / innerHeight - 0.5;
        canvasRef.current.style.transform =
          `scale(1.06) translate3d(${(-dx * 24).toFixed(1)}px,${(-dy * 16).toFixed(1)}px,0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { removeEventListener('pointermove', move); cancelAnimationFrame(raf); };
  }, [reduced]);

  const stratumStyle = (w: readonly [number, number], i: number) => {
    const [a, b] = w;
    if (reduced) return { opacity: 1 };
    let o = 0, shift = 24;
    if (progress >= a && progress <= b) {
      const local = (progress - a) / (b - a);
      /* The hero is present at rest and only fades OUT. Easing it in leaves
         the page's first painted frame with no headline on it. */
      const fadeIn = i < 0 ? 1 : Math.min(local / 0.3, 1);
      o = fadeIn * (1 - Math.max((local - 0.72) / 0.28, 0));
      shift = (1 - fadeIn) * 24;
    }
    return { opacity: o, transform: `translateY(${shift.toFixed(1)}px)` };
  };

  const heroStyle = reduced
    ? { opacity: 1 }
    : (() => {
        const o = 1 - Math.max((progress - 0.1) / 0.1, 0);
        return { opacity: Math.max(o, 0) };
      })();

  return (
    <section ref={sectionRef} className="relative h-[520vh]" aria-label="The descent">
      <div className="sticky top-0 h-screen overflow-hidden">
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-[1.06] object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-abyss/55 via-transparent to-abyss" />

        {!reduced ? (
          <>
            <div
              ref={lightRef}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 -ml-[210px] -mt-[210px] h-[420px] w-[420px] rounded-full mix-blend-screen"
              style={{
                background:
                  'radial-gradient(circle closest-side, rgba(43,245,208,.13), rgba(79,200,255,.06) 42%, transparent 72%)',
              }}
            />
            <div
              ref={coreRef}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 -ml-[3px] -mt-[3px] h-1.5 w-1.5 rounded-full bg-glow"
              style={{ boxShadow: '0 0 10px 2px rgba(43,245,208,.8)' }}
            />
          </>
        ) : null}

        {/* Depth readout. Decorative, so the number is aria-hidden; the strata
            captions carry the same depths as real text. */}
        <div aria-hidden="true" className="absolute right-5 top-1/2 hidden -translate-y-1/2 items-center gap-3 sm:flex">
          <span className="t-mono [writing-mode:vertical-rl] tabular-nums">
            {Math.round(progress * 4850).toLocaleString('en-GB')} m
          </span>
          <div className="relative h-[42vh] w-px bg-gradient-to-b from-ink/25 to-ink/5">
            <div
              className="absolute -left-[3px] h-[7px] w-[7px] rounded-full bg-glow"
              style={{ top: `${progress * 100}%`, boxShadow: '0 0 12px 3px rgba(43,245,208,.55)' }}
            />
          </div>
        </div>

        <div
          className="absolute left-5 top-1/2 max-w-[min(46ch,86vw)] -translate-y-1/2 sm:left-[6vw]"
          style={heroStyle}
        >
          <div ref={heroRef} className="t-display text-ink">{hero}</div>
        </div>

        {strata.map((s, i) => (
          <div
            key={s.depth}
            className={
              s.align === 'right'
                ? 'absolute right-5 top-[28%] max-w-[min(38ch,86vw)] text-right sm:right-[6vw]'
                : 'absolute left-5 top-[28%] max-w-[min(38ch,86vw)] sm:left-[6vw]'
            }
            style={stratumStyle(s.window, i)}
          >
            <p className="t-mono text-glow">{s.depth}</p>
            <p className="t-stratum mt-3">{s.body}</p>
          </div>
        ))}

        <div
          className="absolute bottom-[12vh] left-5 max-w-[min(60ch,88vw)] sm:left-[6vw]"
          style={stratumStyle([0.78, 1], strata.length)}
        >
          {floor}
        </div>
      </div>
    </section>
  );
}

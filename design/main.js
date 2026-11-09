/* =========================================================================
   Crypto Inheritance Vault — "Geological permanence"
   The three rolled techniques, woven rather than bolted on:
     1. kinetic variable typography   — type compresses under depth + pointer
     2. scroll choreography           — pinned descent, staged strata
     3. magnetic / warping cursor     — the dive light, and what leans toward it
   Motion signature: a real scrubbed frame sequence on canvas.
   ========================================================================= */

const FRAME_COUNT = 90;
const FRAME_URL = i => `./assets/frames/descent_${String(i).padStart(4, '0')}.webp`;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

/* ---------------------------------------------------------------- scrub --- */

const canvas = document.getElementById('descent-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
const frames = new Array(FRAME_COUNT);
let framesReady = 0;
let currentFrame = -1;

function drawFrame(i) {
  const img = frames[i];
  if (!img || !img.complete || i === currentFrame) return;
  currentFrame = i;
  // Cover-fit: the canvas backing store is fixed, the CSS box is not.
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

function preload() {
  // Load the first frame synchronously-ish so the hero is never empty, then
  // fill in the rest. Decoding 90 webp frames up front is what makes the scrub
  // feel like a scrub instead of a slideshow.
  const order = [];
  for (let i = 0; i < FRAME_COUNT; i++) order.push(i);
  order.sort((a, b) => Math.abs(a - 0) - Math.abs(b - 0));

  order.forEach(i => {
    const img = new Image();
    img.decoding = 'async';
    img.src = FRAME_URL(i);
    img.onload = () => {
      framesReady++;
      if (i === 0) drawFrame(0);
    };
    frames[i] = img;
  });
}

/* ------------------------------------------------------- choreography ----- */

const descent = document.getElementById('descent');
const strata = [...document.querySelectorAll('.stratum')];
const railBug = document.getElementById('rail-bug');
const railLabel = document.getElementById('rail-label');
const heroType = document.getElementById('hero-type');
const kinetic = [...document.querySelectorAll('[data-kinetic]')];
const contact = document.getElementById('contact');

// Where in the pinned scroll each stratum owns the screen.
const WINDOWS = [
  [0.00, 0.17],
  [0.19, 0.34],
  [0.37, 0.52],
  [0.56, 0.72],
  [0.78, 1.00],
];

let descentProgress = 0;

function updateDescent() {
  const rect = descent.getBoundingClientRect();
  const total = descent.offsetHeight - window.innerHeight;
  const p = total > 0 ? Math.min(Math.max(-rect.top / total, 0), 1) : 0;
  descentProgress = p;

  drawFrame(Math.min(FRAME_COUNT - 1, Math.round(p * (FRAME_COUNT - 1))));

  /* The rail reads actual depth while the descent is on screen. 4850 m is the
     floor, and the captions on the page agree with that figure. */

  // Staged reveals: each stratum fades up through its window and away again.
  strata.forEach((el, i) => {
    const w = WINDOWS[i];
    if (!w) return;
    const [a, b] = w;
    let o = 0, shift = 30;
    if (p >= a && p <= b) {
      const local = (p - a) / (b - a);
      /* Stratum 0 is the hero: fully present at rest, and it only fades OUT.
         Easing it in meant the page's first painted frame carried no headline
         at all, which is what the first audit pass caught. */
      const fadeIn = i === 0 ? 1 : Math.min(local / 0.3, 1);
      o = fadeIn * (1 - Math.max((local - 0.72) / 0.28, 0));
      shift = (1 - fadeIn) * 30;
    }
    el.style.opacity = o.toFixed(3);
    const base = el.dataset.stratum === '0' ? 'translateY(-50%)' : '';
    el.style.transform = `${base} translateY(${shift.toFixed(1)}px)`;
  });

  /* The contact marker shares stratum 4's window — it IS the floor moment, so
     it arrives with the caption rather than floating independently. */
  if (contact) {
    const [a, b] = WINDOWS[4];
    let o = 0;
    if (p >= a && p <= b) o = Math.min((p - a) / ((b - a) * 0.35), 1);
    contact.style.opacity = o.toFixed(3);
  }

  // Technique 1: the hero compresses under depth. Archivo's wdth axis runs
  // 62-125; pressure squeezes it toward the narrow end as you descend, which is
  // what sediment does and what the contract asks the type to say.
  if (heroType) {
    const wdth = 118 - p * 50;
    const wght = 780 - p * 230;
    heroType.style.fontVariationSettings = `'wght' ${wght.toFixed(0)}, 'wdth' ${wdth.toFixed(0)}`;
    heroType.style.letterSpacing = `${(-0.035 - p * 0.012).toFixed(4)}em`;
  }
}

/* ------------------------------------------------------------- grain ----- */
/*
   Sensor grain, composited once over the descent rather than baked into every
   frame. Baking it cost ~30 KB per frame — 2.7 MB to store the same statistical
   texture ninety times — because high-frequency noise is precisely what a lossy
   codec spends its bits on. Generated here it costs no bytes at all, stays
   crisp at 1:1 instead of scaling with the frame, and is identical in character
   because it is the same Gaussian field the renderer was adding.
*/
function makeGrain(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // Box-Muller, so the distribution matches the renderer's rng.normal().
    const u = Math.random() || 1e-9, v = Math.random();
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const val = Math.max(0, Math.min(255, 128 + n * 34));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

(function applyGrain() {
  const stage = document.getElementById('descent-stage');
  if (!stage) return;
  const layer = document.createElement('div');
  layer.className = 'grain';
  layer.style.backgroundImage = `url(${makeGrain()})`;
  stage.appendChild(layer);
})();

/* ------------------------------------------------------------ the rail ---- */
/*
   A fixed instrument spine. It carries depth through the descent and then the
   section index through the rest of the document, so the page always has a
   structural element on screen rather than type floating on a texture.
*/

const SECTION_LABELS = [
  ['descent',   null],
  ['channels',  'I  \u00b7  the arrangement'],
  ['paper',     'II  \u00b7  what survives'],
  ['maths',     'III  \u00b7  the arithmetic'],
  ['refusals',  'IV  \u00b7  the refusals'],
];

function updateRail() {
  if (!railBug || !railLabel) return;
  const railH = innerHeight * 0.76;
  const top = innerHeight * 0.12;

  const dRect = descent.getBoundingClientRect();
  const inDescent = dRect.bottom > innerHeight * 0.5;

  if (inDescent) {
    railBug.style.transform = `translateY(${(top + descentProgress * railH).toFixed(1)}px)`;
    railLabel.textContent = `${Math.round(descentProgress * 4850).toLocaleString('en-GB')} m \u00b7 descending`;
    railLabel.style.transform = `translateY(${(top + descentProgress * railH).toFixed(1)}px)`;
    return;
  }

  const docP = Math.min(Math.max(
    scrollY / Math.max(document.body.scrollHeight - innerHeight, 1), 0), 1);
  railBug.style.transform = `translateY(${(top + docP * railH).toFixed(1)}px)`;
  railLabel.style.transform = `translateY(${(top + docP * railH).toFixed(1)}px)`;

  let label = '4 850 m \u00b7 the floor';
  for (const [id, text] of SECTION_LABELS) {
    if (!text) continue;
    const el = document.getElementById(id);
    if (el && el.getBoundingClientRect().top < innerHeight * 0.6) label = text;
  }
  railLabel.textContent = label;
}

/* ------------------------------------------------- dive light / magnetism -- */

const light = document.getElementById('dive-light');
const core = document.getElementById('dive-core');
let px = innerWidth / 2, py = innerHeight / 2;   // pointer
let lx = px, ly = py;                            // lagging halo

if (!coarse && !reduced) {
  addEventListener('pointermove', e => { px = e.clientX; py = e.clientY; }, { passive: true });
  addEventListener('pointerdown', () => light.style.opacity = '1.6');
  addEventListener('pointerup', () => light.style.opacity = '1');
}

/* Technique 3 lives here: the halo lags the pointer (water resistance), the
   frame parallaxes away from it, and kinetic headings lean toward it. */
function updatePointer() {
  lx += (px - lx) * 0.085;
  ly += (py - ly) * 0.085;
  if (light) light.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
  if (core) core.style.transform = `translate3d(${px}px, ${py}px, 0)`;

  if (canvas) {
    const dx = (lx / innerWidth - 0.5);
    const dy = (ly / innerHeight - 0.5);
    canvas.style.transform =
      `scale(1.06) translate3d(${(-dx * 26).toFixed(2)}px, ${(-dy * 18).toFixed(2)}px, 0)`;
  }

  // Kinetic headings respond to pointer proximity: letterforms widen as the
  // light reaches them, the way something lit resolves out of the dark.
  kinetic.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(lx - cx, ly - cy);
    const near = Math.max(0, 1 - d / 640);          // 0 far, 1 under the light
    const wdth = 86 + near * 34;
    const wght = 560 + near * 260;
    el.style.fontVariationSettings = `'wght' ${wght.toFixed(0)}, 'wdth' ${wdth.toFixed(0)}`;
  });
}

/* ------------------------------------------------------------- reveals ---- */

if (!reduced) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
  document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));
} else {
  document.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('in'));
}

/* --------------------------------------------------------------- loop ----- */

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { updateDescent(); updateRail(); ticking = false; });
}

function raf() {
  updatePointer();
  requestAnimationFrame(raf);
}

preload();
updateDescent();
updateRail();
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => { currentFrame = -1; updateDescent(); }, { passive: true });
if (!reduced && !coarse) raf();

import type { ReactNode } from 'react';

/**
 * Shared primitives, on the "Geological permanence" design language.
 *
 * Product surfaces get the palette, the type system and a shallow tilt on
 * headings. They deliberately do NOT get the landing page's pinned descent:
 * a custody planner behind a 560vh scroll would be hostile, and the one place
 * the full treatment earns its weight is the page whose job is to make the
 * argument.
 */

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">{children}</div>;
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="t-display-sm tilted text-ink">{children}</h1>;
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display text-xl uppercase tracking-tight text-ink"
        style={{ fontVariationSettings: "'wght' 680, 'wdth' 104" }}>
      {children}
    </h2>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  /* mb clears the tilted heading that usually follows: rotation about the left
     edge lifts the right side of the heading upward into this line. */
  return <p className="t-mono mb-7">{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="t-say mt-6 max-w-[62ch]">{children}</p>;
}

export function Card({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'warn' | 'danger' | 'ok';
}) {
  const tones = {
    plain: 'border-[#1B2A3C] bg-[#070D16]',
    warn: 'border-warn/40 bg-warn/[0.06]',
    danger: 'border-danger/45 bg-danger/[0.07]',
    ok: 'border-glow/30 bg-glow/[0.05]',
  } as const;
  return <section className={`border p-6 ${tones[tone]}`}>{children}</section>;
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const variants = {
    primary: 'bg-glow text-abyss hover:bg-[#5CFADF]',
    secondary: 'border border-[#2A3B4F] bg-transparent text-ink hover:border-glow/60 hover:text-glow',
    danger: 'border border-danger/60 bg-transparent text-danger hover:bg-danger/10',
  } as const;
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center px-5 py-2.5 font-mono text-[.7rem] uppercase tracking-[.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${variants[variant]} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="t-mono block text-ink/80">{label}</span>
      {hint ? <span className="mt-1.5 block max-w-[58ch] text-[.8rem] leading-relaxed text-muted">{hint}</span> : null}
      <span className="mt-3 block">{children}</span>
    </label>
  );
}

export const inputClass =
  'w-full border border-[#2A3B4F] bg-[#070D16] px-3.5 py-2.5 text-[.95rem] text-ink ' +
  'placeholder:text-muted/60 focus:border-glow focus:outline-none focus:ring-1 focus:ring-glow';

export function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'due' | 'risk' | 'never';
  children: ReactNode;
}) {
  const tones = {
    ok: 'border-glow/40 text-glow',
    due: 'border-warn/45 text-warn',
    risk: 'border-danger/55 text-danger',
    never: 'border-muted/40 text-muted',
  } as const;
  return (
    <span className={`inline-flex border px-2.5 py-1 font-mono text-[.62rem] uppercase tracking-[.14em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A statement the user must not be able to skim past. */
export function HardWarning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-l-2 border-danger bg-danger/[0.07] py-5 pl-6 pr-5">
      <p className="font-mono text-[.68rem] font-semibold uppercase tracking-[.18em] text-danger">
        {title}
      </p>
      <div className="mt-3 space-y-3 text-[1.02rem] leading-relaxed text-ink/90">{children}</div>
    </div>
  );
}

/** A horizontal rule on the grid's diagonal. */
export function Hair({ className = '' }: { className?: string }) {
  return <div className={`hair ${className}`} />;
}

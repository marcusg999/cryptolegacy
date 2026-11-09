import type { ReactNode } from 'react';

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">{children}</div>;
}

export function H1({ children }: { children: ReactNode }) {
  return <h1 className="text-3xl font-semibold tracking-tight text-ink">{children}</h1>;
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight text-ink">{children}</h2>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-base leading-relaxed text-ink/70">{children}</p>;
}

export function Card({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'warn' | 'danger' | 'ok';
}) {
  const tones = {
    plain: 'border-ink/15 bg-white',
    warn: 'border-warn/40 bg-warn/5',
    danger: 'border-danger/40 bg-danger/5',
    ok: 'border-ok/30 bg-ok/5',
  } as const;
  return (
    <section className={`rounded-lg border p-5 shadow-sm ${tones[tone]}`}>{children}</section>
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const variants = {
    primary: 'bg-ink text-paper hover:bg-ink-soft',
    secondary: 'border border-ink/25 bg-white text-ink hover:bg-ink/5',
    danger: 'bg-danger text-white hover:opacity-90',
  } as const;
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${props.className ?? ''}`}
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
      <span className="block text-sm font-medium text-ink">{label}</span>
      {hint ? <span className="mt-1 block text-xs text-ink/60">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-ink/25 bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink';

export function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'due' | 'risk' | 'never';
  children: ReactNode;
}) {
  const tones = {
    ok: 'bg-ok/10 text-ok border-ok/30',
    due: 'bg-warn/10 text-warn border-warn/30',
    risk: 'bg-danger/10 text-danger border-danger/40',
    never: 'bg-ink/10 text-ink/70 border-ink/20',
  } as const;
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A statement the user must not be able to skim past. */
export function HardWarning({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border-2 border-danger bg-danger/5 p-5">
      <p className="text-sm font-bold uppercase tracking-wide text-danger">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink">{children}</div>
    </div>
  );
}

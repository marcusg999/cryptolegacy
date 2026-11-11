'use client';

import { useEffect, useState } from 'react';

import { BITS_PER_WORD } from '@/lib/crypto/constants';
import { HardWarning } from '@/components/ui';

/**
 * The one screen in the product where the passphrase is on display.
 *
 * Spec §3.2: "Display once, full screen, with screenshot discouraged and
 * clipboard access disabled."
 *
 * Be honest about what is achievable here. A web page cannot prevent a
 * screenshot — no API exists, and any claim otherwise would be a lie told to
 * the user. What it can do is remove the frictionless paths (copy button,
 * select-all, right-click copy, autofill) and say plainly why. The real
 * protection is that the phrase is never transmitted, so a screenshot in the
 * user's own photo library is a risk they are choosing, knowingly.
 */
export function PassphraseDisplay({
  words,
  onContinue,
}: {
  words: readonly string[];
  onContinue: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [wroteItDown, setWroteItDown] = useState(false);

  // Suppress copy/cut from this subtree. Spec §3.2 asks for clipboard access to
  // be disabled; this is the honest extent of what a page can do.
  useEffect(() => {
    const block = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-passphrase-region]')) {
        e.preventDefault();
        e.clipboardData?.setData(
          'text/plain',
          'Your vault passphrase is not copyable. Write it on paper — see the printable sheet.',
        );
      }
    };
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    return () => {
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
    };
  }, []);

  const entropy = Math.round(words.length * BITS_PER_WORD);

  return (
    <div className="space-y-6">
      <HardWarning title="There is no password reset. There cannot be one.">
        <p>
          This passphrase is the only thing that can decrypt your vault. We do not have it, we
          never receive it, and we cannot derive it. It is not in our database in any form — not
          the phrase, not a hash of it, not a &ldquo;hint&rdquo;.
        </p>
        <p>
          If you lose it, <strong>everything in this vault is gone permanently</strong>. Not
          delayed, not recoverable by support, not recoverable by a court order. That is the
          property that makes the vault worth having, and it cuts both ways.
        </p>
        <p>
          Write it on paper now. You will be asked to type it back from that paper before the
          vault is created, so the written copy has to exist first.
        </p>
      </HardWarning>

      <div
        data-passphrase-region
        className="no-select border-2 border-[#2A3B4F] bg-[#070D16] p-6"
        onContextMenu={(e) => e.preventDefault()}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Your vault passphrase — {words.length} words, about {entropy} bits of randomness
        </p>
        <ol className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {words.map((word, i) => (
            <li key={`${i}-${word}`} className="flex items-baseline gap-2">
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink/40">
                {i + 1}
              </span>
              <span className="passphrase-word font-mono text-lg font-medium tracking-tight text-ink">
                {word}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-5 border-t border-[#16222F] pt-4 text-xs text-ink/60">
          All lower case. Single space between words. The hyphens in words like
          <span className="font-mono"> t-shirt </span>
          are part of the word.
        </p>
      </div>

      <div className="space-y-3 text-sm">
        <p className="text-ink/70">
          Avoid screenshots and photos. A screenshot lands in a cloud photo library that is
          protected by an account password, which is a weaker secret than this phrase and is
          recoverable by someone else. We cannot stop you taking one — no website can — so this is
          a request, with the reason given.
        </p>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={wroteItDown}
            onChange={(e) => setWroteItDown(e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>I have written this passphrase on paper, by hand.</span>
        </label>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1 h-4 w-4"
          />
          <span>
            I understand that losing this passphrase destroys access to everything in the vault,
            permanently, and that nobody — including this service — can recover it for me.
          </span>
        </label>
      </div>

      <button
        type="button"
        disabled={!acknowledged || !wroteItDown}
        onClick={onContinue}
        className="inline-flex items-center justify-center bg-glow px-5 py-2.5 font-mono text-[.7rem] uppercase tracking-[.16em] text-abyss transition-colors hover:bg-[#5CFADF] disabled:cursor-not-allowed disabled:opacity-35"
      >
        Next: type it back from your written copy
      </button>
    </div>
  );
}

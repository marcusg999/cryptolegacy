'use client';

import { CUSTODY_POINT_TYPES } from '@/lib/custody/types';

/**
 * Spec §3.2: "Offer a printable, high-contrast transcription sheet sized for a
 * safe deposit box, with checkboxes for each custody location."
 *
 * The sheet prints BLANK. The words go on by hand.
 *
 * That is a deliberate decision rather than an oversight: printing the phrase
 * would push it through the print spooler, where it lands on disk, into a
 * network print queue, and quite possibly into a shared office printer's job
 * history. Handwriting also produces the one artefact a compromised machine
 * cannot have captured. The sheet's job is to give the handwriting structure —
 * numbered slots so a word cannot land in the wrong position, and a custody
 * table so the user records where each copy went.
 */
export function TranscriptionSheet({
  wordCount,
  vaultLabel,
}: {
  wordCount: number;
  vaultLabel: string;
}) {
  const slots = Array.from({ length: wordCount }, (_, i) => i + 1);

  return (
    <div className="print-sheet mx-auto max-w-[150mm] border border-ink/20 bg-white p-8 text-ink shadow-sm">
      <div className="border-b-2 border-ink pb-3">
        <h1 className="text-lg font-bold uppercase tracking-wide">Vault passphrase — written copy</h1>
        <p className="mt-1 text-xs">
          Vault: <span className="font-semibold">{vaultLabel}</span>
        </p>
      </div>

      <p className="mt-4 text-xs leading-relaxed">
        Write the {wordCount} words of your vault passphrase in the numbered boxes below, in order,
        in block capitals. Nothing is printed here for you — that is on purpose, so the phrase never
        passes through a printer or a print queue.
      </p>

      <ol className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
        {slots.map((n) => (
          <li key={n} className="flex items-end gap-2">
            <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums">{n}.</span>
            <span className="h-7 flex-1 border-b-2 border-ink" />
          </li>
        ))}
      </ol>

      <div className="mt-8 border-t-2 border-ink pt-4">
        <h2 className="text-sm font-bold uppercase tracking-wide">Where this copy is kept</h2>
        <p className="mt-1 text-xs">
          Fill in one row for each place a copy of this sheet is stored. Keep the filled-in list
          with your will, not with this sheet.
        </p>
        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-ink">
              <th className="w-6 py-1 text-left"></th>
              <th className="py-1 text-left font-semibold">Where / who</th>
              <th className="w-24 py-1 text-left font-semibold">Type</th>
              <th className="w-28 py-1 text-left font-semibold">Date placed</th>
              <th className="w-20 py-1 text-left font-semibold">Full or part</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((row) => (
              <tr key={row} className="border-b border-ink/30">
                <td className="py-3">
                  <span className="inline-block h-3 w-3 border border-ink" />
                </td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] text-ink/60">
          Types: {CUSTODY_POINT_TYPES.join(' · ')}
        </p>
      </div>

      <div className="mt-7 border-2 border-ink p-3">
        <p className="text-xs font-bold uppercase">If you are not the owner of this sheet</p>
        <p className="mt-1 text-xs leading-relaxed">
          This is a passphrase for an encrypted inheritance vault. It is not a bank password and
          there is no account it can be used to steal money from directly. Do not photograph it,
          type it into a computer, email it, or read it aloud to anyone who telephones you. If the
          owner has died, the executor named in their will should follow the Executor Letter kept
          with the will. If you have found this and do not know what it is, return it to the owner
          or their attorney, sealed.
        </p>
      </div>

      <p className="mt-5 text-[10px] text-ink/50">
        This sheet contains no printed secret. Once you have written on it, it is as sensitive as
        the vault it opens. Fold it, seal it, and store it where your custody plan says.
      </p>
    </div>
  );
}

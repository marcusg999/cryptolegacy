'use client';

import { BITS_PER_WORD, RECOMMENDED_SPLIT_WORDS } from '@/lib/crypto/constants';
import {
  MARGINAL_BELOW_BITS,
  REFUSE_BELOW_BITS,
  analyseSplit,
  minimumWordsForSplit,
} from '@/lib/custody/entropy';
import type { CustodyMode } from '@/lib/custody/types';

/**
 * Spec §4.2: "This is the single most important decision in the user's setup, and
 * most people get it wrong by default. Present it as a deliberate fork with
 * honest tradeoffs."
 *
 * So there is no default selected, no option labelled "recommended" in the
 * abstract, and no way past this screen without choosing. The entropy arithmetic
 * is computed and shown — spec: "do the entropy arithmetic in the UI rather than
 * asserting it" — so the user can see *why* a four-way split of a twelve-word
 * phrase is refused rather than being told it is unsafe.
 */
export function CustodyModeChoice({
  mode,
  partCount,
  wordCount,
  onModeChange,
  onPartCountChange,
}: {
  mode: CustodyMode | null;
  partCount: number;
  wordCount: number;
  onModeChange: (mode: CustodyMode) => void;
  onPartCountChange: (count: number) => void;
}) {
  const analysis = partCount >= 1 && partCount <= wordCount ? analyseSplit(wordCount, partCount) : null;

  return (
    <div className="space-y-5">
      <Option
        selected={mode === 'redundancy'}
        onSelect={() => onModeChange('redundancy')}
        title="Full copies in several places"
        subtitle="Survives loss. Any one copy opens the vault."
      >
        <p>
          Each custody point holds the complete passphrase. If one copy burns, floods, or is in a
          safe deposit box at a branch that closed, the others still work.
        </p>
        <p>
          The cost is that every copy is somewhere it could be stolen from, and every holder could
          act alone. More copies means more of both.
        </p>
        <p className="font-medium text-ink">
          This is the right answer for most people, for an unglamorous reason: loss is
          overwhelmingly more likely than betrayal. The people who lose crypto to a lost passphrase
          vastly outnumber the people who lose it to a treacherous custodian.
        </p>
      </Option>

      <Option
        selected={mode === 'hybrid'}
        onSelect={() => onModeChange('hybrid')}
        title="Two full copies with different failure modes"
        subtitle="Survives loss and survives one custodian going dark. Needs no coordination."
      >
        <p>
          Still full copies, but deliberately placed so that no single event takes both — for
          example your attorney&rsquo;s firm safe and a bank safe deposit box. A house fire does not
          reach either. One custodian becoming unreachable does not matter.
        </p>
        <p className="font-medium text-ink">
          If you are unsure which to pick, this is usually it.
        </p>
      </Option>

      <Option
        selected={mode === 'split'}
        onSelect={() => onModeChange('split')}
        title="Split across several places, all parts required"
        subtitle="Survives betrayal. Does NOT survive loss."
      >
        <p>
          The passphrase is divided into parts and no holder has the whole thing. Nobody can act
          alone, and nobody can be coerced into opening the vault alone.
        </p>
        <p className="font-semibold text-danger">
          Losing any one part destroys access permanently, which makes this strictly more fragile
          than doing nothing at all. If a part is gone, the vault cannot be opened by you, by your
          executor, or by us.
        </p>
        <p>
          Right only for a high-value vault with custodians you genuinely do not trust
          individually.
        </p>

        {mode === 'split' ? (
          <div className="mt-4 space-y-4 border-t border-[#1B2A3C] pt-4">
            <label className="block">
              <span className="text-sm font-medium text-ink">How many parts?</span>
              <select
                className="mt-2 w-full border border-[#2A3B4F] bg-[#070D16] px-3 py-2 text-sm"
                value={partCount}
                onChange={(e) => onPartCountChange(Number(e.target.value))}
              >
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} parts
                  </option>
                ))}
              </select>
            </label>

            {analysis ? <EntropyMath analysis={analysis} wordCount={wordCount} /> : null}
          </div>
        ) : null}
      </Option>
    </div>
  );
}

function EntropyMath({
  analysis,
  wordCount,
}: {
  analysis: ReturnType<typeof analyseSplit>;
  wordCount: number;
}) {
  const tone = analysis.refused
    ? 'border-danger bg-danger/5'
    : analysis.verdict === 'marginal'
      ? 'border-warn/50 bg-warn/5'
      : 'border-ok/40 bg-ok/5';

  return (
    <div className={` border-2 p-4 text-sm ${tone}`}>
      <p className="font-semibold text-ink">The arithmetic</p>

      <dl className="mt-3 space-y-2 text-ink/85">
        <Row
          label="Whole passphrase"
          value={`${wordCount} words × ${BITS_PER_WORD.toFixed(2)} bits = ${analysis.totalEntropyBits.toFixed(0)} bits`}
        />
        <Row label="Divided into" value={`${analysis.partSizes.join(' / ')} words`} />
        <Row
          label="One treacherous holder still has to guess"
          value={`${wordCount - Math.max(...analysis.partSizes)} words = ${analysis.residualAgainstSingleHolderBits.toFixed(0)} bits`}
        />
        <Row
          label={`All ${analysis.partCount - 1} other holders together still have to guess`}
          value={`${Math.min(...analysis.partSizes)} words = ${analysis.residualAgainstCoalitionBits.toFixed(0)} bits`}
          emphasis
        />
      </dl>

      <p className="mt-3 text-xs leading-relaxed text-ink/70">
        The second number is the one that governs. &ldquo;Everyone but one&rdquo; is not a far-fetched
        scenario — it is what a house fire plus one cooperative relative looks like, or one burglar
        who visits two of your three locations. We treat below {REFUSE_BELOW_BITS} bits as
        unacceptable and below {MARGINAL_BELOW_BITS} bits as marginal.
      </p>

      <ul className="mt-3 space-y-1.5 text-ink">
        {analysis.findings.map((finding, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="text-ink/40">
              —
            </span>
            <span>{finding}</span>
          </li>
        ))}
      </ul>

      {analysis.refused ? (
        <p className="mt-3 rounded border border-danger/50 bg-[#070D16] p-3 text-ink">
          <strong>This split is not allowed.</strong> To split into {analysis.partCount} parts
          safely you would need at least {minimumWordsForSplit(analysis.partCount)} words
          (comfortably, {analysis.wordsNeededForStrongSplit}). You cannot lengthen an existing
          passphrase — there is no reset — so either use fewer parts, or create a new vault with a
          longer passphrase and move your contents across.
        </p>
      ) : null}

      {!analysis.refused && wordCount < RECOMMENDED_SPLIT_WORDS ? (
        <p className="mt-3 text-xs text-ink/70">
          For future vaults you intend to split, generate {RECOMMENDED_SPLIT_WORDS} words or more.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className={emphasis ? 'font-semibold text-ink' : ''}>{label}</dt>
      <dd className={`font-mono text-xs ${emphasis ? 'font-semibold text-ink' : 'text-ink/70'}`}>
        {value}
      </dd>
    </div>
  );
}

function Option({
  selected,
  onSelect,
  title,
  subtitle,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={` border-2 p-5 transition ${
        selected ? 'border-[#2A3B4F] bg-[#070D16] ' : 'border-[#1B2A3C] bg-[#070D16]/60'
      }`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="custody-mode"
          checked={selected}
          onChange={onSelect}
          className="mt-1 h-4 w-4"
        />
        <span>
          <span className="block font-semibold text-ink">{title}</span>
          <span className="mt-0.5 block text-sm text-ink/60">{subtitle}</span>
        </span>
      </label>
      <div className="mt-3 space-y-2 pl-7 text-sm leading-relaxed text-ink/75">{children}</div>
    </div>
  );
}

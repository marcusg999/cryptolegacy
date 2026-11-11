'use client';

import { useState } from 'react';

import { CustodyModeChoice } from '@/components/CustodyModeChoice';
import { PassphraseDisplay } from '@/components/PassphraseDisplay';
import { UnlockGate } from '@/components/UnlockGate';
import type { CustodyMode } from '@/lib/custody/types';

/** Client wrappers so the dev preview can render stateful components. */

const SAMPLE = [
  'witch', 'collapse', 'practice', 'feed', 'shame', 'open',
  'despair', 'creek', 'road', 'again', 'ice', 'least',
];

export function PassphrasePreview() {
  return <PassphraseDisplay words={SAMPLE} onContinue={() => {}} />;
}

export function UnlockPreview() {
  return (
    <UnlockGate
      vaultId="00000000-0000-4000-8000-000000000000"
      vaultLabel="Personal crypto"
      lockTimeoutSeconds={300}
    >
      <p className="t-say">Unlocked content would appear here.</p>
    </UnlockGate>
  );
}

export function CustodyModeChoicePreview() {
  const [mode, setMode] = useState<CustodyMode | null>('split');
  const [parts, setParts] = useState(3);
  return (
    <CustodyModeChoice
      mode={mode}
      partCount={parts}
      wordCount={12}
      onModeChange={setMode}
      onPartCountChange={setParts}
    />
  );
}

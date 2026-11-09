import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next ships flat config directly from Next 16, so no
 * FlatCompat shim is needed (and the shim in fact fails on it).
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'out/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // The cryptographic core carries rules the rest of the app does not need.
    // These duplicate part of scripts/check-crypto-leaks.mjs on purpose: this is
    // the fast signal in the editor, that one is the gate in CI.
    files: ['src/lib/crypto/**/*.ts', 'src/lib/custody/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Key material must never be persisted.' },
        { name: 'sessionStorage', message: 'Key material must never be persisted.' },
        { name: 'indexedDB', message: 'Key material must never be persisted.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'Key material must never be persisted.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
]

export default config;

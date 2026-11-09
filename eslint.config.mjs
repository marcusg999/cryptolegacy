import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/lib/crypto/**/*.ts'],
    rules: {
      // The crypto module must stay free of logging. scripts/check-crypto-leaks.mjs
      // enforces this in CI as well; this is the fast local signal.
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Key material must never be persisted.' },
        { name: 'sessionStorage', message: 'Key material must never be persisted.' },
      ],
    },
  },
];

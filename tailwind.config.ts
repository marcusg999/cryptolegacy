import type { Config } from 'tailwindcss';

/**
 * Design tokens from design/CONTRACT.md — "Geological permanence".
 *
 * The contract's palette is the app's palette now, including the rule that the
 * one warm tone is reserved exclusively for the physical-paper channel. It is
 * named `paper` so that using it anywhere else reads wrong at the call site.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss: '#04070C',
        bed: { 1: '#0A1320', 2: '#0F1E2E', 3: '#152838' },
        ink: '#DDE9F1',
        muted: '#65809A',
        glow: '#2BF5D0',
        cyan: '#4FC8FF',
        /* The physical channel, and nothing else. See the contract. */
        paper: '#E9DFCB',
        danger: '#FF6B5A',
        warn: '#E8B44A',
        ok: '#2BF5D0',
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;

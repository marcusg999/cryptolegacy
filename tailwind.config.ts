import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0b1020', soft: '#141a2e', line: '#273150' },
        paper: '#f7f7f4',
        danger: '#b3261e',
        warn: '#8a5a00',
        ok: '#1b5e20',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;

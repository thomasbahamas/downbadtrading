import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        solana: '#9945FF',
        'solana-light': '#B77DFF',
        'solana-dark': '#7B2FD9',
        profit: '#22C55E',
        loss: '#EF4444',
        warning: '#F59E0B',
        'surface-0': '#0A0A0F',
        'surface-1': '#111118',
        'surface-2': '#1A1A22',
        'surface-3': '#24242E',
        'surface-border': '#2A2A36',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;

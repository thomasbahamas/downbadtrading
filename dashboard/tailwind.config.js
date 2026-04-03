/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Solana purple accent
        solana: {
          DEFAULT: '#9945FF',
          light: '#C278FF',
          dark: '#7333CC',
        },
        // Dark theme surfaces
        surface: {
          0: '#0A0A0B',  // page background
          1: '#111113',  // card background
          2: '#1A1A1E',  // elevated card
          3: '#222228',  // input / hover
          border: '#2A2A32',
        },
        // Status colors
        profit: '#22C55E',
        loss: '#EF4444',
        warning: '#F59E0B',
        neutral: '#6B7280',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
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

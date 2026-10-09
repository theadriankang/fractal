import typography from '@tailwindcss/typography'
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        gray: {
          50: '#f9f9f9', 100: '#ececec', 200: '#e3e3e3', 300: '#cdcdcd', 400: '#b4b4b4',
          500: '#9b9b9b', 600: '#676767', 700: '#4e4e4e', 800: '#333333', 850: '#262626',
          900: '#171717', 950: '#0d0d0d',
        },
        accent: { 400: '#7dd3c0', 500: '#2dd4bf', 600: '#14b8a6' },
      },
      keyframes: {
        fadeIn: { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        blink: { '50%': { opacity: 0 } },
        recGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,.55), 0 0 24px 4px rgba(239,68,68,.35)' },
          '50%': { boxShadow: '0 0 0 14px rgba(239,68,68,0), 0 0 48px 12px rgba(239,68,68,.25)' },
        },
      },
      animation: { fadeIn: 'fadeIn .25s ease-out', blink: 'blink 1s step-end infinite', recGlow: 'recGlow 1.8s ease-in-out infinite' },
    },
  },
  plugins: [typography],
}

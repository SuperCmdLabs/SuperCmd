/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--on-surface-rgb) / <alpha-value>)',
        black: 'rgb(var(--backdrop-rgb) / <alpha-value>)',
        sc: {
          bg: 'var(--bg-primary)',
          card: 'var(--card-bg)',
          input: 'var(--input-bg)',
          border: 'var(--border-primary)',
          accent: 'var(--accent)',
          'accent-hover': 'var(--accent-hover)',
          text: 'var(--text-primary)',
          'text-secondary': 'var(--text-secondary)',
          'text-muted': 'var(--text-muted)',
        },
      },
    },
  },
  plugins: [],
};

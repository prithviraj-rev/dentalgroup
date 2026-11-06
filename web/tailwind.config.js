/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        page: 'var(--page)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        good: 'var(--good)',
        bad: 'var(--bad)',
        // Theme page tokens (server/theme.js)
        thead: 'var(--thead)',
        theadInk: 'var(--thead-ink)',
        total: 'var(--total-row)',
        pressed: 'var(--pressed)',
        pressedInk: 'var(--pressed-ink)',
      },
    },
  },
  plugins: [],
};

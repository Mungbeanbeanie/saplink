/** Tokens mirror organic.css so Tailwind utilities stay on the design system. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)', ink: 'var(--color-text)',
        accent: { DEFAULT: 'var(--color-accent)', 200: 'var(--color-accent-200)', 600: 'var(--color-accent-600)', 900: 'var(--color-accent-900)' },
        sage: { DEFAULT: 'var(--color-accent-2)', 200: 'var(--color-accent-2-200)', 600: 'var(--color-accent-2-600)', 800: 'var(--color-accent-2-800)', 900: 'var(--color-accent-2-900)' },
        sand: { 100: 'var(--color-neutral-100)', 200: 'var(--color-neutral-200)', 300: 'var(--color-neutral-300)', 600: 'var(--color-neutral-600)', 700: 'var(--color-neutral-700)', 800: 'var(--color-neutral-800)', 900: 'var(--color-neutral-900)' }
      },
      fontFamily: { heading: ['Caprasimo', 'serif'], body: ['Figtree', 'sans-serif'] },
      borderRadius: { lg: 'var(--radius-lg)' },
      boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)', lg: 'var(--shadow-lg)' }
    }
  },
  plugins: []
};

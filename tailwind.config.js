/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Poppins', 'sans-serif'],
        display: ['Cinzel', 'serif'],
        ui: ['Sora', 'Inter', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace']
      },
      colors: {
        'resource-wood': '#8B5A2B',
        'resource-clay': '#9A3412',
        'resource-iron': '#94A3B8',
        'resource-wheat': '#D6A23A',
        'primary-bg': '#030303',
        'primary-border': 'rgba(245, 196, 81, 0.26)',
        'glass-bg': 'rgba(5, 5, 5, 0.56)',
        'glass-light-bg': 'rgba(255, 255, 255, 0.075)',
        'btn-primary-bg': '#A44B1B',
        'btn-primary-hover': '#C45A22',
        'btn-secondary-bg': 'rgba(17, 17, 17, 0.72)',
        'btn-secondary-hover': 'rgba(38, 38, 38, 0.82)',
        'royal-blue-border': 'rgba(245, 196, 81, 0.36)',
        'contrast-border': 'rgba(245, 196, 81, 0.32)',
        'war-ember': '#F97316',
        'war-gold': '#F5C451',
        'war-blood': '#991B1B',
        'war-leather': '#090909',
        'war-ash': '#050505',
        'war-mist': '#F8E7C5'
      }
    }
  },
  plugins: []
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Poppins', 'sans-serif'],
        display: ['Cinzel', 'serif'],
        mono: ['Roboto Mono', 'monospace']
      },
      colors: {
        'resource-wood': '#8B5A2B',
        'resource-clay': '#9A3412',
        'resource-iron': '#94A3B8',
        'resource-wheat': '#D6A23A',
        'primary-bg': '#120D0A',
        'primary-border': '#8A5A2B',
        'glass-bg': 'rgba(24, 17, 12, 0.82)',
        'glass-light-bg': 'rgba(245, 158, 11, 0.10)',
        'btn-primary-bg': '#A44B1B',
        'btn-primary-hover': '#C45A22',
        'btn-secondary-bg': '#3F2B1F',
        'btn-secondary-hover': '#5A3A27',
        'royal-blue-border': '#A16207',
        'contrast-border': '#D97706',
        'war-ember': '#F97316',
        'war-gold': '#F5C451',
        'war-blood': '#991B1B',
        'war-leather': '#2B1B14',
        'war-ash': '#1C1917',
        'war-mist': '#F8E7C5'
      }
    }
  },
  plugins: []
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Poppins', 'sans-serif'],
        mono: ['Roboto Mono', 'monospace']
      },
      colors: {
        'resource-wood': '#A0522D',
        'resource-clay': '#B22222',
        'resource-iron': '#778899',
        'resource-wheat': '#B8860B',
        'primary-bg': '#1A202C',
        'primary-border': '#4A6980',
        'glass-bg': 'rgba(26, 32, 44, 0.7)',
        'glass-light-bg': 'rgba(137, 180, 217, 0.15)',
        'btn-primary-bg': '#34495E',
        'btn-primary-hover': '#415A70',
        'btn-secondary-bg': '#5F7C8A',
        'btn-secondary-hover': '#73909E',
        'royal-blue-border': '#4A6980',
        'contrast-border': '#89B4D9'
      }
    }
  },
  plugins: []
};

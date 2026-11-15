/** Tailwind configuration for the dark space HUD of C'est Lunaire. */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/app/*.js', './src/education/*.js', './src/rover/*.js', './src/science/*.js', './src/terrain/*.js', './src/ui/*.js'],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#040811',
          900: '#07111e',
          800: '#0c1b2b'
        },
        hud: {
          line: 'rgb(var(--hud-line) / <alpha-value>)',
          text: 'rgb(var(--hud-text) / <alpha-value>)',
          muted: 'rgb(var(--hud-muted) / <alpha-value>)'
        },
        signal: {
          sun: '#F5C84C',
          earth: '#F05D6C',
          intersection: '#4AD295'
        }
      },
      fontFamily: {
        hud: ['IBM Plex Sans', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Consolas', 'monospace']
      },
      boxShadow: {
        instrument: '0 12px 36px rgb(0 0 0 / 0.35), inset 0 1px rgb(255 255 255 / 0.04)'
      }
    }
  },
  plugins: []
};

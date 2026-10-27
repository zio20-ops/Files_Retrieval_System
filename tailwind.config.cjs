/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F3EE',
        surface: '#FFFFFF',
        sunken: '#EDEAE2',
        ink: '#16181C',
        'ink-soft': '#3D424B',
        muted: '#767B85',
        line: '#DFDBD1',
        'line-strong': '#C7C2B5',
        panel: '#16181C',
        'panel-soft': '#22262D',
        'panel-line': '#343A43',
        'panel-text': '#EDEBE4',
        'panel-muted': '#9AA0AB',
        accent: {
          DEFAULT: '#0E6B52',
          hover: '#0A5641',
          soft: '#E1EFE9',
          text: '#0A5641'
        },
        mark: '#FFD98A',
        'mark-strong': '#F5B942',
        danger: '#B4321F',
        warn: '#9A6410',
        ok: '#2C6E49'
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'Segoe UI',
          'Tahoma',
          'system-ui',
          '-apple-system',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'Cascadia Mono', 'Consolas', 'monospace']
      },
      fontSize: {
        '2xs': ['11px', '16px']
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(22,24,28,0.04), 0 1px 3px 0 rgba(22,24,28,0.06)',
        pop: '0 8px 24px -4px rgba(22,24,28,0.18)'
      }
    }
  },
  plugins: []
}

/** @type {import('tailwindcss').Config} */
// Colour names are kept so existing markup keeps working; the values follow docs/DESIGN-RULES.md
// (Kain³e pink-purple glass × Kang Chiao colours, 2026-11-24).
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        kc: {
          blue: '#7b2f8f',
          'blue-deep': '#2e0f38',
          'blue-soft': '#a77fb3',
          purple: '#7b2f8f',
          'purple-deep': '#5b2a6e',
          'purple-soft': '#b08abf',
          mist: '#fbf2f6',
          ink: '#2e0f38',
          muted: '#5b3b66',
          faint: '#8d7395',
          kcis: '#900080',
          teal: '#0098a0',
          rose: '#c8306b',
          violet: '#6a46c8',
          plum: '#7b2f8f',
        },
      },
      fontFamily: {
        display: ['Comfortaa', 'Nunito', 'PingFang TC','Microsoft JhengHei','Noto Sans TC', 'PingFang TC', 'sans-serif'],
        body: ['Nunito', 'PingFang TC','Microsoft JhengHei','Noto Sans TC', 'PingFang TC', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        kc: '0 26px 80px rgba(200, 48, 107, 0.13), inset 0 1px rgba(255, 255, 255, 0.55)',
        'kc-lg': '0 30px 90px rgba(200, 48, 107, 0.17), inset 0 1px rgba(255, 255, 255, 0.55)',
        soft: '0 18px 48px rgba(200, 48, 107, 0.1)',
      },
      animation: {
        fadeIn: 'fadeIn 0.9s cubic-bezier(.16,1,.3,1) backwards',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

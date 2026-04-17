import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // M3 Primary
        primary: 'var(--md-primary)',
        'on-primary': 'var(--md-on-primary)',
        'primary-container': 'var(--md-primary-container)',
        'on-primary-container': 'var(--md-on-primary-container)',

        // M3 Secondary
        secondary: 'var(--md-secondary)',
        'on-secondary': 'var(--md-on-secondary)',
        'secondary-container': 'var(--md-secondary-container)',

        // M3 Surface system
        surface: 'var(--md-surface)',
        'surface-dim': 'var(--md-surface-dim, #E4D8D0)',
        'surface-container': 'var(--md-surface-container, #F8ECE4)',
        'surface-container-high': 'var(--md-surface-container-high, #F3E6DE)',
        'surface-variant': 'var(--md-surface-variant)',
        'on-surface': 'var(--md-on-surface)',
        'on-surface-variant': 'var(--md-on-surface-variant)',

        // M3 Outline
        outline: 'var(--md-outline)',
        'outline-variant': 'var(--md-outline-variant)',

        // M3 Error
        error: 'var(--md-error)',
        'on-error': 'var(--md-on-error)',
        'error-container': 'var(--md-error-container)',

        // M3 Success
        success: 'var(--md-success, #1B6D2A)',
        'success-container': 'var(--md-success-container, #A4F5A2)',

        // Agent type colors (static — no theming needed)
        'type-person': '#2e7d32',
        'type-org': '#1565c0',
        'type-ai': '#7b1fa2',
        'type-hub': '#e65100',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        // M3 Typography Scale
        'display-lg': ['3.5625rem', { lineHeight: '4rem', letterSpacing: '-0.015em' }],
        'display-md': ['2.8125rem', { lineHeight: '3.25rem', letterSpacing: '0' }],
        'display-sm': ['2.25rem', { lineHeight: '2.75rem', letterSpacing: '0' }],
        'headline-lg': ['2rem', { lineHeight: '2.5rem', letterSpacing: '0' }],
        'headline-md': ['1.75rem', { lineHeight: '2.25rem', letterSpacing: '0' }],
        'headline-sm': ['1.5rem', { lineHeight: '2rem', letterSpacing: '0' }],
        'title-lg': ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '0' }],
        'title-md': ['1rem', { lineHeight: '1.5rem', letterSpacing: '0.01em' }],
        'title-sm': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.01em' }],
        'body-lg': ['1rem', { lineHeight: '1.5rem', letterSpacing: '0.03em' }],
        'body-md': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.025em' }],
        'body-sm': ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.04em' }],
        'label-lg': ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '0.01em', fontWeight: '500' }],
        'label-md': ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.05em', fontWeight: '500' }],
        'label-sm': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.05em', fontWeight: '500' }],
      },
      borderRadius: {
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '28px',
        'full': '9999px',
      },
      boxShadow: {
        'elevation-1': '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15)',
        'elevation-2': '0 1px 2px rgba(0,0,0,0.3), 0 2px 6px 2px rgba(0,0,0,0.15)',
        'elevation-3': '0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3)',
        'elevation-4': '0 6px 10px 4px rgba(0,0,0,0.15), 0 2px 3px rgba(0,0,0,0.3)',
      },
      spacing: {
        // M3 4px grid
        '0.5': '2px',
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
        '20': '80px',
        '24': '96px',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 200ms ease-out',
        'slide-in-right': 'slideInRight 250ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config

/** @type {import('tailwindcss').Config} */
// Exposes the branding.md --ws-* tokens (declared in src/styles/tokens.css) as
// Tailwind utilities so components use bg-ws-navy / text-ws-gold / border-ws-line
// / font-display / p-ws-4 / rounded-ws-md / shadow-ws-md — and NEVER raw hex
// (master.md §2 invariant 7). tokens.css stays the single source of values;
// this file only references them via var(), so editing a token updates every
// utility. Names mirror the token names 1:1.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Core locked palette
        'ws-navy': 'var(--ws-navy)',
        'ws-steel': 'var(--ws-steel)',
        'ws-gold': 'var(--ws-gold)',
        'ws-offwhite': 'var(--ws-offwhite)',
        'ws-slate': 'var(--ws-slate)',
        'ws-seagreen': 'var(--ws-seagreen)',
        // Derived surfaces
        'ws-navy-deep': 'var(--ws-navy-deep)',
        'ws-steel-2': 'var(--ws-steel-2)',
        'ws-steel-3': 'var(--ws-steel-3)',
        'ws-steel-inset': 'var(--ws-steel-inset)',
        // Hairlines & borders
        'ws-line': 'var(--ws-line)',
        'ws-line-strong': 'var(--ws-line-strong)',
        'ws-line-faint': 'var(--ws-line-faint)',
        // Text
        'ws-text': 'var(--ws-text)',
        'ws-text-muted': 'var(--ws-text-muted)',
        'ws-text-faint': 'var(--ws-text-faint)',
        'ws-text-on-gold': 'var(--ws-text-on-gold)',
        // Gold accent states
        'ws-gold-bright': 'var(--ws-gold-bright)',
        'ws-gold-dim': 'var(--ws-gold-dim)',
        'ws-gold-ghost': 'var(--ws-gold-ghost)',
        'ws-gold-glow': 'var(--ws-gold-glow)',
        // Dashboard metric colours
        'ws-metric-balance': 'var(--ws-metric-balance)',
        'ws-metric-weekend': 'var(--ws-metric-weekend)',
        'ws-metric-rotation': 'var(--ws-metric-rotation)',
        'ws-metric-status': 'var(--ws-metric-status)',
        // Semantic status
        'ws-ok': 'var(--ws-ok)',
        'ws-warn': 'var(--ws-warn)',
        'ws-alert': 'var(--ws-alert)',
        'ws-info': 'var(--ws-info)',
        // Fairness gauge scale
        'ws-fair-high': 'var(--ws-fair-high)',
        'ws-fair-mid': 'var(--ws-fair-mid)',
        'ws-fair-low': 'var(--ws-fair-low)',
        // Print medium (B3) — light treatment for paper/PDF
        'ws-print-bg': 'var(--ws-print-bg)',
        'ws-print-ink': 'var(--ws-print-ink)',
        'ws-print-muted': 'var(--ws-print-muted)',
        'ws-print-line': 'var(--ws-print-line)',
        'ws-print-weekend': 'var(--ws-print-weekend)',
        'ws-print-gold': 'var(--ws-print-gold)',
      },
      fontFamily: {
        display: 'var(--ws-font-display)',
        ui: 'var(--ws-font-ui)',
        mono: 'var(--ws-font-mono)',
      },
      fontSize: {
        'ws-xs': 'var(--ws-text-xs)',
        'ws-sm': 'var(--ws-text-sm)',
        'ws-base': 'var(--ws-text-base)',
        'ws-md': 'var(--ws-text-md)',
        'ws-lg': 'var(--ws-text-lg)',
        'ws-xl': 'var(--ws-text-xl)',
        'ws-2xl': 'var(--ws-text-2xl)',
        'ws-3xl': 'var(--ws-text-3xl)',
      },
      lineHeight: {
        'ws-tight': 'var(--ws-leading-tight)',
        'ws-normal': 'var(--ws-leading-normal)',
        'ws-relaxed': 'var(--ws-leading-relaxed)',
      },
      letterSpacing: {
        'ws-tight': 'var(--ws-tracking-tight)',
        'ws-normal': 'var(--ws-tracking-normal)',
        'ws-wide': 'var(--ws-tracking-wide)',
        'ws-mono': 'var(--ws-tracking-mono)',
      },
      spacing: {
        'ws-1': 'var(--ws-space-1)',
        'ws-2': 'var(--ws-space-2)',
        'ws-3': 'var(--ws-space-3)',
        'ws-4': 'var(--ws-space-4)',
        'ws-5': 'var(--ws-space-5)',
        'ws-6': 'var(--ws-space-6)',
        'ws-7': 'var(--ws-space-7)',
        'ws-8': 'var(--ws-space-8)',
      },
      borderRadius: {
        'ws-sm': 'var(--ws-radius-sm)',
        'ws-md': 'var(--ws-radius-md)',
        'ws-lg': 'var(--ws-radius-lg)',
        'ws-full': 'var(--ws-radius-full)',
      },
      boxShadow: {
        'ws-sm': 'var(--ws-shadow-sm)',
        'ws-md': 'var(--ws-shadow-md)',
        'ws-lg': 'var(--ws-shadow-lg)',
        'ws-glow-gold': 'var(--ws-glow-gold)',
      },
    },
  },
  plugins: [],
}

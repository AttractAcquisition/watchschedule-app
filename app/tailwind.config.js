/** @type {import('tailwindcss').Config} */
// Phase 0 wires the branding.md --ws-* tokens into theme.extend
// (colors / fontFamily / spacing / borderRadius). Kept minimal for the scaffold.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}

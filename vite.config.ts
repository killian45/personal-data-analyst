import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

import { readPublicHeaders } from './src/server/headers.node.ts'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ask the user before switching to a new version, instead of
      // reloading automatically, so unsaved input is never lost.
      registerType: 'prompt',

      // Registration is done by the UpdateBanner component.
      injectRegister: false,

      // The manifest is maintained in public/manifest.webmanifest.
      manifest: false,

      workbox: {
        // Precache the whole app shell at install time, so the app
        // works offline from the first visit after installation.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,wasm}'],

        // Serve the app for any navigation while offline.
        navigateFallback: '/index.html',

        // Remove caches left by older service worker versions.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // "npm run preview:public" only: the public build with the website's
  // security headers (public/_headers). The owner's local app (vite
  // preview on port 5173) is started without PDA_PUBLIC_PREVIEW and is
  // not affected.
  preview: process.env.PDA_PUBLIC_PREVIEW ? { headers: readPublicHeaders() } : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,

    // Let tests read src/index.css (the dark mode guard test needs it).
    // Other stylesheets stay disabled in tests.
    css: {
      include: [/src\/index\.css/],
    },

    // Run tests in a fixed timezone that is neither UTC nor the default
    // Europe/Paris, so code that silently relies on the machine's own
    // timezone is caught.
    env: {
      TZ: 'America/New_York',
      // Tests never talk to a real sync server, even if .env.local exists.
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
})

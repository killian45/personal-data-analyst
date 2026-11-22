import type { CapacitorConfig } from '@capacitor/cli'

// Android app wrapper (Phase 4, docs/ANDROID_PLAN.md).
// The built web app (dist/) is copied into the Android project by
// "npx cap sync android". It is served at https://localhost inside the
// app, so the browser encryption (Web Crypto) is available.
const config: CapacitorConfig = {
  appId: 'com.personaldataanalyst.app',
  appName: 'Personal Data Analyst',
  webDir: 'dist',
  android: {
    // Never load content over plain http.
    allowMixedContent: false,
  },
}

export default config

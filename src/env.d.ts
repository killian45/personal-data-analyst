/// <reference types="vite/client" />

// Build-time settings (see .env.example). Only PUBLIC values may use the
// VITE_ prefix: they end up in the code sent to the browser.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

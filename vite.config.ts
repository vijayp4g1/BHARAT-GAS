import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Hard guard: the Supabase service_role key must never be bundled into the
  // browser. Privileged operations go through the admin-api Edge Function.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Refusing to build: VITE_SUPABASE_SERVICE_ROLE_KEY is set. ' +
        'The service_role key must never ship to the browser. ' +
        'Remove it from .env files / Vercel and use the admin-api Edge Function instead.'
    )
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true
        },
        manifest: {
          name: 'Bharat Gas Consumer Location System',
          short_name: 'BGCLS',
          description: 'Offline-first progressive web app for delivery agents',
          theme_color: '#1E3A8A',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    build: {
      chunkSizeWarningLimit: 2000,
    },
  }
})

import { fileURLToPath } from 'node:url'

const h3Safe = fileURLToPath(new URL('./shims/h3-safe.mjs', import.meta.url))
const sourceMapSafe = fileURLToPath(new URL('./shims/source-map-safe.cjs', import.meta.url))

export default defineNuxtConfig({
  nitro: {
    alias: {
      h3: h3Safe,
      'source-map': sourceMapSafe,
    },
  },
  css: ['~/assets/css/main.css', '~/assets/css/player-chrome.css'],
  app: {
    head: {
      title: 'Local Media Center',
      meta: [
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
      ],
    },
  },
  experimental: {
    appManifest: false,
  },
  runtimeConfig: {
    adminToken: '',
  },
})

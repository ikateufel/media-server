export default defineNuxtConfig({
  css: ['~/assets/css/main.css'],
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

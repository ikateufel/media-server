export default defineNuxtConfig({
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Local Media Center',
    },
  },
  experimental: {
    appManifest: false,
  },
  runtimeConfig: {
    adminToken: '',
  },
})

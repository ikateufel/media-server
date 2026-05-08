export default defineNuxtConfig({
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

function detectSilkTvLikeUa(): boolean {
  if (!import.meta.client || typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return (
    /\bSilk\b/i.test(ua) ||
    /\bAFT[A-Z]\w*\b/i.test(ua) ||
    /AmazonWebAppPlatform/i.test(ua)
  )
}

/**
 * Amazon Silk no Fire TV (e variantes) frequentemente não reporta safe-area útil e o UA é distinguível.
 * Usamos isto só para CSS/comportamento de UX — não para segurança.
 *
 * `isSilkTvLike` é avaliado já no cliente antes do mount para não haver corrida com `loadTrailers`.
 */
export function useSilkTvLayout() {
  const isSilkTvLike = ref(detectSilkTvLikeUa())

  onMounted(() => {
    isSilkTvLike.value = detectSilkTvLikeUa()
  })

  return { isSilkTvLike }
}

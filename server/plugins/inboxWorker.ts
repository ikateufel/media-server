import { startInboxWorkerOnBoot } from '../utils/inboxWorker'

/**
 * Arranca o inbox worker (timer) se estiver enabled nas settings.
 */
export default defineNitroPlugin(() => {
  void startInboxWorkerOnBoot()
})

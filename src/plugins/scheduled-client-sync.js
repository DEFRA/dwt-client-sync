import cron from 'node-cron'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'
import { config } from '#/config.js'

const logger = createLogger()

const startupSyncAttempts = 5
const startupSyncRetryMs = 5_000

// Retried, as the services it syncs from may still be starting
async function syncOnStartup(db, locker) {
  for (let attempt = 1; attempt <= startupSyncAttempts; attempt++) {
    try {
      logger.info(await sync(db, locker))
      return
    } catch (err) {
      logger.error(
        `Startup client sync attempt ${attempt} of ${startupSyncAttempts} failed: ${err.message}`
      )
    }

    if (attempt < startupSyncAttempts) {
      await new Promise((resolve) => setTimeout(resolve, startupSyncRetryMs))
    }
  }

  logger.error(
    'Startup client sync gave up. The next scheduled sync will store the clients'
  )
}

export const scheduledClientSync = {
  plugin: {
    name: 'scheduled-client-sync',
    register(server) {
      const { syncSchedule, syncOnStartup: shouldSyncOnStartup } =
        config.get('cognito')

      const { db, locker } = server

      // In the background, so a slow sync doesn't hold up the server starting
      if (shouldSyncOnStartup) {
        server.events.on('start', () => {
          syncOnStartup(db, locker)
        })
      }

      cron.schedule(
        syncSchedule,
        async () => {
          logger.info(`Scheduled client sync starting`)

          try {
            const results = await sync(db, locker)
            logger.info(results)
          } catch (err) {
            logger.error(`Scheduled client sync failed: ${err.message}`)
          }

          logger.info(`Scheduled client sync finished`)
        },
        { noOverlap: true, name: 'client-sync-schedule' }
      )
    }
  }
}

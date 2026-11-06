import cron from 'node-cron'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'
import { config } from '#/config.js'

const logger = createLogger()

async function syncOnStartup(db, locker) {
  try {
    logger.info(await sync(db, locker))
  } catch (err) {
    logger.error(`Startup client sync failed: ${err.message}`)
  }
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

import cron from 'node-cron'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'
import { config } from '#/config.js'

const logger = createLogger()

export const scheduledClientSync = {
  plugin: {
    name: 'scheduled-client-sync',
    register() {
      const { syncSchedule } = config.get('cognito')

      cron.schedule(
        syncSchedule,
        async () => {
          logger.info(`Scheduled client sync starting`)

          const results = await sync()

          logger.info(results)

          logger.info(`Scheduled client sync finished`)
        },
        { noOverlap: true, name: 'client-sync-schedule' }
      )
    }
  }
}

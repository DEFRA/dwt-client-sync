import { allCognitoCredentials } from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { acquireLock, releaseLock } from '#/common/helpers/mongo-lock.js'
import { readStoredClients, store } from '#/services/clients.js'
import { toClientRecord } from '#/models/client-mapper.js'
import { managedServices } from '#/common/helpers/managed-services.js'

const logger = createLogger()
async function sync(db, locker) {
  logger.info('Software Provider sync starting')
  let lock

  const result = {
    totalServicesProcessed: 0,
    services: []
  }

  try {
    const services = managedServices()

    if (services.length === 0) {
      logger.info('No services configured to sync, skipping.')
      return result
    } else {
      lock = await acquireLock(locker, 'dwt-client-sync', logger)
      if (!lock) {
        logger?.info('DWT client sync already in progress elsewhere, skipping')
        return result
      }

      logger.info(`Syncing ${services.length} services: ${services.join(', ')}`)

      for (const service of services) {
        logger.info(`Syncing service ${service}...`)

        // Read before listing CDP, so this sync can't delete a client that
        // create saves while it's running (see readStoredClients)
        const storedClients = await readStoredClients(logger, db, service)
        const cognitoClients = await allCognitoCredentials(service)

        if (!cognitoClients) {
          logger.error('No credentials found in Cognito response')
          result.services.push({ serviceName: service, credentialsSynced: 0 })
          continue
        }

        logger.info(`Fetched ${cognitoClients.length} Cognito credentials`)

        const softwareProviders = cognitoClients.map((client) =>
          toClientRecord(client, service)
        )

        logger.info(
          `Storing ${softwareProviders.length} software providers in the database`
        )

        await store(logger, db, softwareProviders, service, storedClients)

        result.services.push({
          serviceName: service,
          credentialsSynced: softwareProviders.length
        })
      }

      result.totalServicesProcessed = result.services.length
      logger.info('Software Provider sync completed successfully')
      return result
    }
  } catch (error) {
    logger.error(`Error fetching Cognito credentials ${error}`)
    throw error
  } finally {
    await releaseLock(lock, logger)
  }
}

export { sync }

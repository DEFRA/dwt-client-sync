import { allCognitoCredentials } from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { config } from '#/config.js'

const logger = createLogger()
const { serviceSyncList } = config.get('cognito')
async function sync() {
  logger.info('Software Provider sync starting')

  const result = {
    totalServicesProcessed: 0,
    services: []
  }

  try {
    const services = serviceSyncList
      ? serviceSyncList
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

    if (services.length === 0) {
      logger.info('No services configured to sync, skipping.')
      return result
    } else {
      logger.info(`Syncing ${services.length} services: ${services.join(', ')}`)

      for (const service of services) {
        logger.info(`Syncing service ${service}...`)

        const credentials = await allCognitoCredentials(service)

        if (!credentials || !credentials.client_details) {
          logger.error('No credentials found in Cognito response')
          result.services.push({ serviceName: service, credentialsSynced: 0 })
          continue
        }

        logger.info(
          `Fetched ${credentials.client_details.length} Cognito credentials`
        )

        const softwareProviders = credentials.client_details.map(
          ({ client_name: clientName, client_id: clientId }) => [
            { text: clientName },
            { text: clientId }
          ]
        )

        logger.info(
          `Storing ${softwareProviders.length} software providers in the database`
        )

        // ... actual DB write goes here

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
    return result
  }
}

export { sync }

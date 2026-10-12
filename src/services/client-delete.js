import { createLogger } from '#/common/helpers/logging/logger.js'
import { config } from '#/config.js'

const logger = createLogger()
const collectionName = config.get('mongo.collectionName')

async function deleteClient(db, clientId, tenantServiceName) {
  logger.info(`Deleting client ${clientId} for service ${tenantServiceName}`)

  try {
    const result = await db
      .collection(collectionName)
      .deleteOne({ clientId, tenantServiceName })

    if (result.deletedCount === 0) {
      logger.warn(
        `No client found with id ${clientId} for service ${tenantServiceName}`
      )
    } else {
      logger.info(
        `Successfully deleted client ${clientId} for service ${tenantServiceName}`
      )
    }

    return result
  } catch (error) {
    logger.error(
      `Error deleting client ${clientId} for service ${tenantServiceName}: ${error}`
    )
    throw error
  }
}

export { deleteClient }

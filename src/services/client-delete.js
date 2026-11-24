import { createLogger } from '#/common/helpers/logging/logger.js'
import { config } from '#/config.js'

const logger = createLogger()
const collectionName = config.get('mongo.collectionName')

/**
 * Deletes a client's stored record. Only the record: CDP is asked separately.
 * @param {import('mongodb').Db} db - The service's database
 * @param {string} clientId - The client's id
 * @param {string} tenantServiceName - The service it's a client of
 * @returns {Promise<import('mongodb').DeleteResult>} How many records were
 * deleted, which is 0 when there was none
 */
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

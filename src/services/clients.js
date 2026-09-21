import { isDeepStrictEqual } from 'node:util'

/**
 * Finds a waste input for the given tenantServiceName and clientId in the given db.
 *
 * @param {String} tenantServiceName - The tenant service name (can be found with `config.get('serviceName')`)
 * @param {String} clientId - The client id
 * @param {MongoDb} db - The db
 *
 * @returns {Promise<{clientName: String, clientId: String, tenantServiceName: String}>} The waste inputs
 */
export function findClient(tenantServiceName, clientId, db) {
  return db
    .collection('clients')
    .findOne({ tenantServiceName, clientId }, { projection: { _id: 0 } })
}

/**
 * Finds waste inputs for the given tenantServiceName in the given db.
 *
 * @param {String} tenantServiceName - The tenant service name (can be found with `config.get('serviceName')`)
 * @param {MongoDb} db - The db
 *
 * @returns {Promise<{clientName: String, clientId: String, tenantServiceName: String}[]>} The waste inputs
 */
export function findClients(tenantServiceName, db) {
  return db
    .collection('clients')
    .find({ tenantServiceName }, { projection: { _id: 0 } })
    .toArray()
}

export async function store(logger, db, incomingClients, tenantServiceName) {
  let existing

  try {
    existing = await db
      .collection('clients')
      .find({ tenantServiceName }, { projection: { _id: 0 } })
      .toArray()
  } catch (error) {
    logger.error(
      `Failed to fetch existing clients for ${tenantServiceName} with error ${error}`
    )
    throw error
  }

  const existingByKey = new Map(existing.map((doc) => [doc.clientId, doc]))
  const incomingByKey = new Map(
    incomingClients.map((doc) => [doc.clientId, doc])
  )

  const operations = []

  // 2. New or changed
  for (const [clientId, incomingDoc] of incomingByKey) {
    const existingDoc = existingByKey.get(clientId)

    if (!existingDoc) {
      // new — insert
      operations.push({
        insertOne: { document: incomingDoc }
      })
    } else if (!isDeepStrictEqual(existingDoc, incomingDoc)) {
      // changed — update
      operations.push({
        updateOne: {
          filter: { clientId, tenantServiceName },
          update: { $set: incomingDoc }
        }
      })
    }
  }

  // Missing from incoming — remove
  for (const clientId of existingByKey.keys()) {
    if (!incomingByKey.has(clientId)) {
      operations.push({
        deleteOne: { filter: { clientId, tenantServiceName } }
      })
    }
  }

  if (operations.length === 0) {
    logger.info('No changes to sync')
    return { inserted: 0, updated: 0, deleted: 0 }
  }

  try {
    const result = await db
      .collection('clients')
      .bulkWrite(operations, { ordered: false })

    logger.info(
      `Sync completed: ${result.insertedCount} inserted, ${result.modifiedCount} updated, ${result.deletedCount} deleted`
    )

    return result
  } catch (error) {
    logger.error(
      `Sync partially or fully failed for ${tenantServiceName} with error ${error}, writeErrors: ${error.writeErrors}, result: ${error.result}`
    )

    throw error
  }
}

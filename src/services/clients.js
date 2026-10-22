import { isDeepStrictEqual } from 'node:util'
import { config } from '#/config.js'

const collectionName = config.get('mongo.collectionName')

/**
 * @typedef {import('#/models/client-mapper.js').ClientRecord} ClientRecord
 */

/**
 * Finds the client for the given tenantServiceName and clientId in the given db.
 *
 * @param {String} tenantServiceName - The tenant service name (can be found with `config.get('serviceName')`)
 * @param {String} clientId - The client id
 * @param {MongoDb} db - The db
 *
 * @returns {Promise<ClientRecord | null>} The stored client
 */
export function findClient(tenantServiceName, clientId, db) {
  return db
    .collection(collectionName)
    .findOne({ tenantServiceName, clientId }, { projection: { _id: 0 } })
}

/**
 * Finds the clients for the given tenantServiceName in the given db.
 *
 * @param {String} tenantServiceName - The tenant service name (can be found with `config.get('serviceName')`)
 * @param {MongoDb} db - The db
 *
 * @returns {Promise<ClientRecord[]>} The stored clients
 */
export function findClients(tenantServiceName, db) {
  return db
    .collection(collectionName)
    .find({ tenantServiceName }, { projection: { _id: 0 } })
    .toArray()
}

/**
 * Stores one client, replacing any stored client with the same id.
 *
 * Sync deletes stored clients that aren't in its list from CDP, so a client
 * saved while a sync runs (after it lists, before it writes) is deleted, and
 * comes back at the next sync. We accept that: the window is under a second,
 * and syncs are scheduled daily.
 *
 * @param {MongoDb} db - The db
 * @param {ClientRecord} record - The client to store
 */
export async function saveClient(db, record) {
  const { tenantServiceName, clientId } = record

  await db
    .collection(collectionName)
    .replaceOne({ tenantServiceName, clientId }, record, { upsert: true })
}

/**
 * Makes the stored clients for the given tenantServiceName match the given clients.
 *
 * @param {Logger} logger - The logger
 * @param {MongoDb} db - The db
 * @param {ClientRecord[]} incomingClients - Every client the service now has
 * @param {String} tenantServiceName - The tenant service name
 */
export async function store(logger, db, incomingClients, tenantServiceName) {
  let existing

  try {
    existing = await db
      .collection(collectionName)
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
      // new:  insert
      operations.push({
        insertOne: { document: incomingDoc }
      })
    } else if (!isDeepStrictEqual(existingDoc, incomingDoc)) {
      // changed:  update
      operations.push({
        updateOne: {
          filter: { clientId, tenantServiceName },
          update: { $set: incomingDoc }
        }
      })
    }
  }

  // Missing from incoming: delete
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
      .collection(collectionName)
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

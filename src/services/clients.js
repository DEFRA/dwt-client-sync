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
 * Stores one client, replacing any stored client with the same id. Safe while
 * a sync runs: see readStoredClients.
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
 * Reads the stored clients for a sync. Sync must call this before it lists
 * the clients from CDP:
 * - Every record read here was saved after its client was created in CDP, so
 *   the list includes it unless the client has since been deleted. This
 *   assumes CDP lists a client as soon as it's created.
 * - A record saved after this read isn't in it, so sync can't delete it.
 *
 * A client created and then deleted while a sync is running can be stored
 * again until the next sync.
 *
 * @param {Logger} logger - The logger
 * @param {MongoDb} db - The db
 * @param {String} tenantServiceName - The tenant service name
 *
 * @returns {Promise<ClientRecord[]>} The stored clients
 */
export async function readStoredClients(logger, db, tenantServiceName) {
  try {
    return await db
      .collection(collectionName)
      .find({ tenantServiceName }, { projection: { _id: 0 } })
      .toArray()
  } catch (error) {
    logger.error(
      `Failed to fetch existing clients for ${tenantServiceName} with error ${error}`
    )
    throw error
  }
}

/**
 * Makes the stored clients for the given tenantServiceName match the given clients.
 *
 * @param {Logger} logger - The logger
 * @param {MongoDb} db - The db
 * @param {ClientRecord[]} incomingClients - Every client the service now has
 * @param {String} tenantServiceName - The tenant service name
 * @param {ClientRecord[]} existing - The stored clients, from readStoredClients
 */
export async function store(
  logger,
  db,
  incomingClients,
  tenantServiceName,
  existing
) {
  const existingByKey = new Map(existing.map((doc) => [doc.clientId, doc]))
  const incomingByKey = new Map(
    incomingClients.map((doc) => [doc.clientId, doc])
  )

  const operations = []

  // 2. New or changed
  for (const [clientId, incomingDoc] of incomingByKey) {
    const existingDoc = existingByKey.get(clientId)

    if (!existingDoc) {
      // new: upsert, as create may have saved it since the stored clients
      // were read
      operations.push({
        replaceOne: {
          filter: { clientId, tenantServiceName },
          replacement: incomingDoc,
          upsert: true
        }
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
      `Sync completed: ${result.upsertedCount} inserted, ${result.modifiedCount} updated, ${result.deletedCount} deleted`
    )

    return result
  } catch (error) {
    logger.error(
      `Sync partially or fully failed for ${tenantServiceName} with error ${error}, writeErrors: ${error.writeErrors}, result: ${error.result}`
    )

    throw error
  }
}

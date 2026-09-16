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
  return db.collection('clients').findOne({ tenantServiceName, clientId })
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

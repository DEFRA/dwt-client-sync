import { listUserPoolClients } from '#/common/helpers/user-pool.js'

/**
 * The clients a tenant service has, by id and name, wherever they're read
 * from. The only place that decides where: today CDP's user pool directly,
 * as CDP's list API takes seconds a page. To use CDP's API instead, swap in
 * allCognitoCredentials from cognito-client.js, which returns the same shape.
 * @param {string} tenantServiceName
 * @returns {Promise<{ clientId: string, clientName: string }[]>}
 */
async function listClients(tenantServiceName) {
  return listUserPoolClients(tenantServiceName)
}

export { listClients }

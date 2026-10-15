/**
 * The client models, following ADR 9 (separate external and internal models).
 * This mapper is the only code that knows both the stored and returned shapes.
 * ClientRecord and ClientResponse hold the same fields today, but are kept
 * apart so what's stored can change without changing the published response.
 *
 * @typedef {import('#/common/helpers/cognito-client.js').CognitoClient} CognitoClient
 *
 * @typedef {object} ClientRecord - A client as stored in the database. Never returned.
 * @property {string} clientId
 * @property {string} clientName
 * @property {string} tenantServiceName
 *
 * @typedef {object} ClientResponse - A client as returned by the GET endpoints
 * @property {string} clientId
 * @property {string} clientName
 * @property {string} tenantServiceName
 *
 * @typedef {object} ClientCredentialsResponse - A client and its new secret, as returned by create and rotate
 * @property {string} clientId
 * @property {string} clientName
 * @property {string} clientSecret
 */

/**
 * @param {CognitoClient} client
 * @param {string} tenantServiceName
 * @returns {ClientRecord}
 */
export function toClientRecord({ clientId, clientName }, tenantServiceName) {
  return { clientId, clientName, tenantServiceName }
}

/**
 * @param {ClientRecord} record
 * @returns {ClientResponse}
 */
export function toClientResponse({ clientId, clientName, tenantServiceName }) {
  return { clientId, clientName, tenantServiceName }
}

/**
 * @param {CognitoClient} client
 * @returns {ClientCredentialsResponse}
 */
export function toClientCredentialsResponse({
  clientId,
  clientName,
  clientSecret
}) {
  return { clientId, clientName, clientSecret }
}

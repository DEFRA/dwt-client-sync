/**
 * The client models, following ADR 9 (separate external and internal models).
 * This mapper is the only code that knows both the stored and returned shapes.
 * ClientRecord and ClientResponse hold the same fields today, but are kept
 * apart so what's stored can change without changing the published response.
 * @typedef {import('#/common/helpers/cognito-client.js').CognitoClient} CognitoClient
 * @typedef {object} ClientRecord - A client as stored in the database. Never returned.
 * @property {string} clientId - Cognito's id for the client
 * @property {string} clientName - The name it was created with
 * @property {string} tenantServiceName - The service it's a client of
 * @property {{ id: string, createdAt: string }[]} [secrets] - Its secrets' ids
 * and when they were created, never the secrets themselves
 * @typedef {object} ClientResponse - A client as returned by the GET endpoints
 * @property {string} clientId - Cognito's id for the client
 * @property {string} clientName - The name it was created with
 * @property {string} tenantServiceName - The service it's a client of
 * @property {{ id: string, createdAt: string }[]} [secrets] - Its secrets'
 * ids and when they were created, never the secrets themselves
 * @typedef {object} ClientCredentialsResponse - A client and its new secret, as returned by create, rotate and replace
 * @property {string} clientId - Cognito's id for the client
 * @property {string} clientName - The name it was created with
 * @property {string} clientSecret - The new secret, which can't be fetched again
 */

/**
 * @param {CognitoClient} client - The client, as Cognito has it
 * @param {string} tenantServiceName - The service it's a client of
 * @returns {ClientRecord} The client as stored, without its secret value
 */
export function toClientRecord(
  { clientId, clientName, secrets },
  tenantServiceName
) {
  return {
    clientId,
    clientName,
    tenantServiceName,
    ...(secrets && { secrets })
  }
}

/**
 * @param {ClientRecord} record - The stored client
 * @returns {ClientResponse} The client as the GET endpoints return it
 */
export function toClientResponse({
  clientId,
  clientName,
  tenantServiceName,
  secrets
}) {
  return { clientId, clientName, tenantServiceName, secrets }
}

/**
 * @param {CognitoClient} client - The client, with the secret it was just given
 * @returns {ClientCredentialsResponse} Its id, name and new secret
 */
export function toClientCredentialsResponse({
  clientId,
  clientName,
  clientSecret
}) {
  return { clientId, clientName, clientSecret }
}

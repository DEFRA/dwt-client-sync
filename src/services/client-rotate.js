import { createLogger } from '#/common/helpers/logging/logger.js'
import {
  getCognitoCredential,
  rotateCognitoCredential
} from '#/common/helpers/cognito-client.js'
import { saveClient } from '#/services/clients.js'
import { toClientRecord } from '#/models/client-mapper.js'
import { RotateOutcome, rotateResult } from '#/domain/client-secrets.js'

/**
 * @typedef {import('#/domain/client-secrets.js').RotateOutcomeValue} RotateOutcomeValue
 * @typedef {import('#/common/helpers/cognito-client.js').CognitoClient} CognitoClient
 */

const logger = createLogger()

/**
 * Issues a stored client a new secret in CDP, keeping its current one. CDP
 * rotates by name, so other clients with exactly that name get one too.
 * Throws a CdpError if CDP's rotate request fails.
 * @param {string} tenantServiceName
 * @param {{ clientId: string, clientName: string }} client - The stored client
 * @returns {Promise<{ outcome: RotateOutcomeValue, rotatedClient?: CognitoClient }>}
 * The RotateOutcome, and the client with its new secret when it was rotated
 */
async function rotateSecret(tenantServiceName, client) {
  const { clientId } = client

  const rotatedClients = await rotateCognitoCredential(
    tenantServiceName,
    client.clientName
  )

  const { outcome, rotatedClient, otherClientsRotated } = rotateResult(
    rotatedClients,
    clientId
  )

  if (otherClientsRotated > 0) {
    logger.warn(
      `Rotating client ${clientId} also rotated ${otherClientsRotated} other client(s) with the same name`
    )
  }

  if (outcome === RotateOutcome.ROTATED) {
    logger.info(
      `Rotated client secret for client ${clientId} of ${tenantServiceName}`
    )
  } else {
    logger.error(`Rotating client ${clientId}: ${outcome}`)
  }

  return { outcome, rotatedClient }
}

/**
 * Stores a rotated client's secrets. CDP has already rotated, so a failure
 * here is only logged: the next sync corrects the stored secrets.
 * @param {object} db
 * @param {string} tenantServiceName
 * @param {CognitoClient} rotatedClient
 */
async function saveRotatedClient(db, tenantServiceName, rotatedClient) {
  let secrets

  try {
    ;({ secrets } = await getCognitoCredential(
      tenantServiceName,
      rotatedClient.clientId
    ))
  } catch (err) {
    logger.error(`Failed to fetch credential metadata: ${err.message}`)
    return
  }

  try {
    await saveClient(
      db,
      toClientRecord({ ...rotatedClient, secrets }, tenantServiceName)
    )
  } catch (err) {
    logger.error(`Saving rotated client failed: ${err.message}`)
  }
}

export { rotateSecret, saveRotatedClient }

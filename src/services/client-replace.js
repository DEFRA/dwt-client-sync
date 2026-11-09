import { createLogger } from '#/common/helpers/logging/logger.js'
import { CdpError } from '#/common/helpers/cognito-client.js'
import { listClients } from '#/services/client-directory.js'
import { rotateSecret } from '#/services/client-rotate.js'
import { purgeOldSecret } from '#/services/client-purge.js'
import { sharesExactName } from '#/domain/client-names.js'
import {
  PurgeOutcome,
  ReplaceOutcome,
  RotateOutcome
} from '#/domain/client-secrets.js'

const logger = createLogger()

/**
 * Purges a client just rotated. The new secret is the newest, so purging
 * leaves only it. Never throws, as the new secret must still be returned.
 * @param {string} tenantServiceName
 * @param {{ clientId: string, clientName: string }} client
 * @returns {Promise<string>} REPLACED, OLD_SECRET_KEPT, or
 * PURGE_OUTCOME_UNKNOWN when CDP may have purged
 */
async function purgeAfterRotating(tenantServiceName, client) {
  try {
    const purgeOutcome = await purgeOldSecret(tenantServiceName, client)

    if (purgeOutcome === PurgeOutcome.PURGED) {
      return ReplaceOutcome.REPLACED
    }

    return purgeOutcome === PurgeOutcome.OUTCOME_UNKNOWN
      ? ReplaceOutcome.PURGE_OUTCOME_UNKNOWN
      : ReplaceOutcome.OLD_SECRET_KEPT
  } catch (err) {
    logger.error(`Purging client ${client.clientId} failed: ${err.message}`)

    return err instanceof CdpError && err.outcomeUnknown
      ? ReplaceOutcome.PURGE_OUTCOME_UNKNOWN
      : ReplaceOutcome.OLD_SECRET_KEPT
  }
}

/**
 * Replaces a stored client's secret in CDP: rotates, then purges, so only the
 * new secret works. Purging first would do nothing with one secret, leaving
 * the old one working after the rotate.
 * Throws a CdpError if CDP's rotate request fails, before anything is purged.
 * @param {string} tenantServiceName
 * @param {{ clientId: string, clientName: string }} client - The stored client
 * @returns {Promise<{ outcome: string, rotatedClient?: import('#/common/helpers/cognito-client.js').CognitoClient }>}
 * A ReplaceOutcome, or the RotateOutcome when the rotate didn't happen, and
 * the client with its new secret when it was rotated
 */
async function replaceSecret(tenantServiceName, client) {
  const { clientId } = client

  // Checked before rotating, as the purge refuses a shared name, which would
  // leave a new secret issued and the old one still working
  const clients = await listClients(tenantServiceName)

  if (sharesExactName(clients, client)) {
    logger.error(
      `Not replacing client ${clientId}: ${ReplaceOutcome.NAME_SHARED}`
    )
    return { outcome: ReplaceOutcome.NAME_SHARED }
  }

  const { outcome, rotatedClient } = await rotateSecret(
    tenantServiceName,
    client
  )

  if (outcome !== RotateOutcome.ROTATED) {
    return { outcome }
  }

  const replaceOutcome = await purgeAfterRotating(tenantServiceName, client)

  if (replaceOutcome === ReplaceOutcome.REPLACED) {
    logger.info(
      `Replaced client secret for client ${clientId} of ${tenantServiceName}`
    )
  } else {
    logger.error(`Replacing client ${clientId}: ${replaceOutcome}`)
  }

  return { outcome: replaceOutcome, rotatedClient }
}

export { replaceSecret }

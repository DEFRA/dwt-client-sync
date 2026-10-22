import { createLogger } from '#/common/helpers/logging/logger.js'
import {
  allCognitoCredentials,
  purgeCognitoCredential
} from '#/common/helpers/cognito-client.js'
import {
  PurgeOutcome,
  purgeCutoff,
  purgeResult
} from '#/domain/client-secrets.js'

const logger = createLogger()

/**
 * Removes a stored client's older secret in CDP, keeping its newest.
 * Throws a CdpError if CDP's purge request fails.
 * @param {string} tenantServiceName
 * @param {{ clientId: string, clientName: string }} client - The stored client
 * @returns {Promise<string>} The PurgeOutcome
 */
async function purgeOldSecret(tenantServiceName, client) {
  const { clientId } = client

  // Only the list says how many secrets the client has
  let cognitoClients
  try {
    cognitoClients = await allCognitoCredentials(tenantServiceName)
  } catch (err) {
    logger.error(`Listing clients before purge failed: ${err.message}`)
  }

  if (!cognitoClients) {
    return PurgeOutcome.LIST_UNREADABLE
  }

  const { cutoff, outcome: refused } = purgeCutoff(cognitoClients, client)

  if (refused) {
    // A client with one secret, or two of the same age, is in a normal state
    const isNormal = [PurgeOutcome.ONE_SECRET, PurgeOutcome.SAME_TIME].includes(
      refused
    )
    logger[isNormal ? 'warn' : 'error'](
      `Not purging client ${clientId}: ${refused}`
    )
    return refused
  }

  const purgedClients = await purgeCognitoCredential(
    tenantServiceName,
    client.clientName,
    cutoff
  )

  const { outcome, otherClientsPurged } = purgeResult(purgedClients, clientId)

  if (otherClientsPurged > 0) {
    logger.error(
      `Purging client ${clientId} also purged ${otherClientsPurged} other client(s) with the same name`
    )
  }

  if (outcome === PurgeOutcome.PURGED) {
    logger.info(
      `Purged old client secrets for client ${clientId} of ${tenantServiceName}`
    )
  } else {
    logger.error(`Purging client ${clientId}: ${outcome}`)
  }

  return outcome
}

export { purgeOldSecret }

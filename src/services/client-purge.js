import { createLogger } from '#/common/helpers/logging/logger.js'
import { purgeCognitoCredential } from '#/common/helpers/cognito-client.js'
import { listUserPoolClients } from '#/common/helpers/user-pool.js'
import { sharesName } from '#/domain/client-names.js'
import { PurgeOutcome, purgeResult } from '#/domain/client-secrets.js'

const logger = createLogger()

/**
 * Removes a stored client's older secrets in CDP, keeping its newest.
 * Throws a CdpError if CDP's purge request fails.
 * @param {string} tenantServiceName
 * @param {{ clientId: string, clientName: string }} client - The stored client
 * @returns {Promise<string>} The PurgeOutcome
 */
async function purgeOldSecret(tenantServiceName, client) {
  const { clientId } = client

  // CDP purges by name, so another client with this name could lose its
  // secret too
  const poolClients = await listUserPoolClients()

  if (sharesName(poolClients, client)) {
    logger.error(`Not purging client ${clientId}: ${PurgeOutcome.NAME_SHARED}`)
    return PurgeOutcome.NAME_SHARED
  }

  // CDP always keeps the newest secret, so the client can't be left without
  // one, and with only one secret this does nothing
  const purgedClients = await purgeCognitoCredential(
    tenantServiceName,
    client.clientName
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

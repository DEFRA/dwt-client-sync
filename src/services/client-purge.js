import { createLogger } from '#/common/helpers/logging/logger.js'
import {
  allCognitoCredentials,
  purgeCognitoCredential
} from '#/common/helpers/cognito-client.js'

const logger = createLogger()

/**
 * What happened to a purge request. Anything but PURGED means no secret was
 * removed, except OUTCOME_UNKNOWN.
 */
const PurgeOutcome = Object.freeze({
  PURGED: 'purged',
  NOT_IN_CDP: 'not in CDP',
  NAME_OUT_OF_DATE: "stored name doesn't match CDP",
  NAME_SHARED: 'another client has the same name',
  SECRETS_UNREADABLE: "CDP's secrets for the client can't be read",
  ONE_SECRET: 'only one secret',
  SAME_TIME: 'two secrets created at the same time',
  NAME_REUSED: 'stored name belongs to a different client',
  OUTCOME_UNKNOWN: "CDP's purge response can't be read"
})

/**
 * Sorts a client's secrets newest first, by when they were created.
 * @param {{ id: string, createdAt: string }[]} secrets
 * @returns {{ secret: { id: string, createdAt: string }, time: number }[] | undefined}
 * undefined when a creation date can't be read
 */
function newestFirst(secrets) {
  const dated = secrets.map((secret) => ({
    secret,
    time: Date.parse(secret.createdAt)
  }))

  if (dated.some(({ time }) => Number.isNaN(time))) {
    return undefined
  }

  return dated.sort((a, b) => b.time - a.time)
}

/**
 * Decides whether a client's older secret can be purged, and the cutoff that
 * keeps its newest.
 * @param {import('#/common/helpers/cognito-client.js').CognitoClient[]} cognitoClients
 * - Every client in CDP
 * @param {{ clientId: string, clientName: string }} client - The stored client
 * @returns {{ cutoff: string } | { outcome: string }} The cutoff, or why not
 */
function purgeCutoff(cognitoClients, { clientId, clientName }) {
  const cognitoClient = cognitoClients.find(
    (listed) => listed.clientId === clientId
  )

  if (!cognitoClient) {
    return { outcome: PurgeOutcome.NOT_IN_CDP }
  }

  if (cognitoClient.clientName !== clientName) {
    return { outcome: PurgeOutcome.NAME_OUT_OF_DATE }
  }

  // Names aren't unique in Cognito, and CDP purges every client with the
  // name, so a purge would also remove the other clients' secrets. CDP's docs
  // don't say whether names match case insensitively, so assume they do
  const name = clientName.toLowerCase()
  const sharesName = cognitoClients.some(
    (listed) =>
      listed.clientName?.toLowerCase() === name && listed.clientId !== clientId
  )

  if (sharesName) {
    return { outcome: PurgeOutcome.NAME_SHARED }
  }

  const { secrets } = cognitoClient

  // CDP never removes a client's newest secret, so none means the list can't
  // be trusted
  if (!Array.isArray(secrets) || secrets.length === 0) {
    return { outcome: PurgeOutcome.SECRETS_UNREADABLE }
  }

  // A client must always keep a secret
  if (secrets.length === 1) {
    return { outcome: PurgeOutcome.ONE_SECRET }
  }

  const sorted = newestFirst(secrets)

  if (!sorted) {
    return { outcome: PurgeOutcome.SECRETS_UNREADABLE }
  }

  const [newest, nextNewest] = sorted

  // Created in the same millisecond, neither secret is before the other's
  // cutoff, so CDP would remove nothing
  if (newest.time === nextNewest.time) {
    return { outcome: PurgeOutcome.SAME_TIME }
  }

  // CDP only removes secrets created before the cutoff, so the newest secret
  // we listed is kept, and so is any secret from a rotation since
  return { cutoff: newest.secret.createdAt }
}

/**
 * Reads CDP's purge response for a client.
 * @param {import('#/common/helpers/cognito-client.js').CognitoClient[] | undefined} purgedClients
 * - Every client CDP processed
 * @param {string} clientId
 * @returns {{ outcome: string, otherClientsPurged: number }}
 */
function purgeResult(purgedClients, clientId) {
  // A success response we can't read: CDP may still have purged
  if (!Array.isArray(purgedClients)) {
    return { outcome: PurgeOutcome.OUTCOME_UNKNOWN, otherClientsPurged: 0 }
  }

  const otherClientsPurged = purgedClients.filter(
    (purged) => purged.clientId !== clientId
  ).length

  // CDP skips clients it doesn't know, leaving nothing purged
  if (purgedClients.length === 0) {
    return { outcome: PurgeOutcome.NOT_IN_CDP, otherClientsPurged }
  }

  // CDP purged other clients with the stored name, but not this one
  if (otherClientsPurged === purgedClients.length) {
    return { outcome: PurgeOutcome.NAME_REUSED, otherClientsPurged }
  }

  return { outcome: PurgeOutcome.PURGED, otherClientsPurged }
}

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
    return PurgeOutcome.SECRETS_UNREADABLE
  }

  const { cutoff, outcome: refused } = purgeCutoff(cognitoClients, client)

  if (refused) {
    logger.error(`Not purging client ${clientId}: ${refused}`)
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

export { PurgeOutcome, purgeCutoff, purgeResult, purgeOldSecret }

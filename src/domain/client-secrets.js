/**
 * @typedef {import('#/common/helpers/cognito-client.js').CognitoClient} CognitoClient
 */

/**
 * What happened to a purge request. PURGED means CDP processed the client.
 * Anything else means no secret of the client's was removed, except
 * OUTCOME_UNKNOWN, where CDP may have purged, and NAME_REUSED, where other
 * clients with the name may have lost a secret.
 */
const PurgeOutcome = Object.freeze({
  PURGED: 'purged',
  NOT_IN_CDP: 'not in CDP',
  NAME_SHARED: 'another client has the same name',
  NAME_REUSED: 'stored name belongs to a different client',
  OUTCOME_UNKNOWN: "CDP's purge response can't be read"
})

/**
 * Reads CDP's purge response for a client.
 * @param {CognitoClient[] | undefined} purgedClients
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
 * Given a list of secrets, returns the list with the oldest removed.
 * If there is only one secret in the list, return the list unchanged.
 * @param {{ id: string, createdAt: string }[]} [secrets]
 * @returns {{ id: string, createdAt: string }[]} The secrets without the oldest
 */
function removeOldestSecret(secrets) {
  if (!Array.isArray(secrets) || secrets.length === 0) {
    return secrets
  }
  if (secrets.length === 1) {
    return secrets
  }

  for (const secret of secrets) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}[+-][0-9]{2}:[0-9]{2}$/.test(secret.createdAt)) {
      throw new Error(`a secret with a bad createdAt date was provided: '${secret.createdAt}'`)
    }
  }

  const oldestCreatedAt = secrets.reduce(
    (oldest, secret) => (secret.createdAt < oldest ? secret.createdAt : oldest),
    secrets[0].createdAt
  )

  return secrets.filter(({ createdAt }) => createdAt !== oldestCreatedAt)
}

export { PurgeOutcome, purgeResult, removeOldestSecret }

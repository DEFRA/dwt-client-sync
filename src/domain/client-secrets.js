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

export { PurgeOutcome, purgeResult }

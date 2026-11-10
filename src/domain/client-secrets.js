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

/** @typedef {(typeof PurgeOutcome)[keyof typeof PurgeOutcome]} PurgeOutcomeValue */

/**
 * Reads CDP's purge response for a client.
 * @param {CognitoClient[] | undefined} purgedClients
 * - Every client CDP processed
 * @param {string} clientId
 * @returns {{ outcome: PurgeOutcomeValue, otherClientsPurged: number }}
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
 * What happened to a rotate request. ROTATED means CDP issued this client a
 * new secret. NOT_IN_CDP and NAME_REUSED mean it didn't, although for
 * NAME_REUSED other clients with the name did get one. OUTCOME_UNKNOWN means
 * CDP may have rotated.
 */
const RotateOutcome = Object.freeze({
  ROTATED: 'rotated',
  NOT_IN_CDP: 'not in CDP',
  NAME_REUSED: 'stored name belongs to a different client',
  OUTCOME_UNKNOWN: "CDP's rotate response can't be read"
})

/** @typedef {(typeof RotateOutcome)[keyof typeof RotateOutcome]} RotateOutcomeValue */

/**
 * Reads CDP's rotate response for a client.
 * @param {CognitoClient[] | undefined} rotatedClients
 * - Every client CDP rotated, with its new secret
 * @param {string} clientId
 * @returns {{ outcome: RotateOutcomeValue, rotatedClient?: CognitoClient, otherClientsRotated: number }}
 */
function rotateResult(rotatedClients, clientId) {
  // A success response we can't read: CDP may still have rotated
  if (!Array.isArray(rotatedClients)) {
    return { outcome: RotateOutcome.OUTCOME_UNKNOWN, otherClientsRotated: 0 }
  }

  // Names aren't unique in Cognito, so pick out this client
  const rotatedClient = rotatedClients.find(
    (rotated) => rotated.clientId === clientId
  )
  const otherClientsRotated = rotatedClients.filter(
    (rotated) => rotated.clientId !== clientId
  ).length

  // CDP skips clients it doesn't know, leaving nothing rotated
  if (rotatedClients.length === 0) {
    return { outcome: RotateOutcome.NOT_IN_CDP, otherClientsRotated }
  }

  // CDP rotated other clients with the stored name, but not this one
  if (!rotatedClient) {
    return { outcome: RotateOutcome.NAME_REUSED, otherClientsRotated }
  }

  return { outcome: RotateOutcome.ROTATED, rotatedClient, otherClientsRotated }
}

/**
 * What happened to a replace request, other than a RotateOutcome when the
 * rotate didn't happen. OLD_SECRET_KEPT and PURGE_OUTCOME_UNKNOWN both mean
 * the client has a new secret, but its old one still works, or may.
 */
const ReplaceOutcome = Object.freeze({
  REPLACED: 'replaced',
  NAME_SHARED: 'another client has the same name',
  OLD_SECRET_KEPT: "the old secret couldn't be removed",
  PURGE_OUTCOME_UNKNOWN: 'the old secret may not have been removed'
})

/** @typedef {(typeof ReplaceOutcome)[keyof typeof ReplaceOutcome]} ReplaceOutcomeValue */

/**
 * @param {ReplaceOutcomeValue | RotateOutcomeValue} outcome
 * @returns {boolean} Whether it's a RotateOutcome, so the rotate didn't happen
 * or its outcome is unknown
 */
function isRotateOutcome(outcome) {
  return Object.values(RotateOutcome).includes(outcome)
}

export {
  PurgeOutcome,
  purgeResult,
  RotateOutcome,
  rotateResult,
  ReplaceOutcome,
  isRotateOutcome
}

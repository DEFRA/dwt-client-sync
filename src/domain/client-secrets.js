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
  NAME_OUT_OF_DATE: "stored name doesn't match CDP",
  NAME_SHARED: 'another client has the same name',
  LIST_UNREADABLE: "CDP's client list can't be read",
  NO_SECRETS: 'CDP lists no secrets for the client',
  DATE_UNREADABLE: "a secret's creation date can't be read",
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
 * @param {CognitoClient[]} cognitoClients
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
    return { outcome: PurgeOutcome.NO_SECRETS }
  }

  // A client must always keep a secret
  if (secrets.length === 1) {
    return { outcome: PurgeOutcome.ONE_SECRET }
  }

  const sorted = newestFirst(secrets)

  if (!sorted) {
    return { outcome: PurgeOutcome.DATE_UNREADABLE }
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

export { PurgeOutcome, purgeCutoff, purgeResult }

import Boom from '@hapi/boom'

import { PurgeOutcome } from '#/domain/client-secrets.js'

// A retry rotates again, and a client holds at most two secrets, so
// retrying blind can remove the secret the caller still uses. Per the CDP
// docs ("Rotate client credentials"): "A new secret is issued and the existing
// secret is retained... If it already has two, the oldest is removed to make
// room." https://github.com/DEFRA/cdp-documentation/blob/main/how-to/managing_cognito_credentials.md
export const OUTCOME_UNKNOWN_MESSAGE =
  'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'

// CDP returns a new client's secret only once, and a retry is skipped as a
// duplicate, so the caller can only get a secret by rotating
export const CREATE_OUTCOME_UNKNOWN_MESSAGE =
  "Create outcome unknown: the client may have been created, but its secret couldn't be returned. It can't be found or rotated here until the next sync (or POST /clients/sync). If it exists then, rotate its secret."

// Returned after the client is saved, so the caller can rotate it straight away
export const CREATE_NO_SECRET_MESSAGE =
  "The client was created, but CDP didn't return its secret. Rotate its secret to get one."

// Purging is idempotent, and the newest secret is always kept, so a retry
// can't leave the client without a secret
export const PURGE_OUTCOME_UNKNOWN_MESSAGE =
  'Purge outcome unknown: the older secret may have been removed. It is safe to try again.'

// Deleting a client that CDP has already deleted does nothing, and its stored
// record is only removed once CDP has deleted it, so a retry finishes the job
export const DELETE_OUTCOME_UNKNOWN_MESSAGE =
  'Delete outcome unknown: the client may have been deleted. It is safe to try again.'

/**
 * A 502, saying whether the requested change happened (`success`, `failure`
 * or `unknown`, as ECS's event.outcome), so a caller can record it
 * @param {string} message
 * @param {'success' | 'failure' | 'unknown'} outcome
 * @param {{ clientId?: string }} [details] - Which client, when it's known
 * @returns {Boom.Boom}
 */
export function badGateway(message, outcome, details = {}) {
  const error = Boom.badGateway(message)
  Object.assign(error.output.payload, details, { outcome })
  return error
}

/**
 * @param {CdpError} err
 * @param {string} outcomeUnknownMessage
 * @param {string} refusedMessage
 * @returns {Boom.Boom} A 502 saying whether CDP may have made the change
 */
export function cdpFailed(err, outcomeUnknownMessage, refusedMessage) {
  return err.outcomeUnknown
    ? badGateway(outcomeUnknownMessage, 'unknown')
    : badGateway(refusedMessage, 'failure')
}

/**
 * @param {string} clientName
 * @returns {Boom.Boom} A 409 naming the client
 */
export function clientNameTaken(clientName) {
  return Boom.conflict(
    `Client name '${clientName}' already exists (case insensitive)`
  )
}

/**
 * @param {string} tenantServiceName
 * @param {string} clientId
 * @returns {Boom.Boom} A 404 naming the client and service
 */
export function clientNotFound(tenantServiceName, clientId) {
  return Boom.notFound(
    `Client '${clientId}' not found for tenant service '${tenantServiceName}'`
  )
}

/**
 * @param {string} outcome - A PurgeOutcome other than PURGED
 * @param {{ clientId: string, clientName: string }} client
 * @returns {Boom.Boom} The error for the outcome
 */
export function purgeError(outcome, { clientId }) {
  switch (outcome) {
    case PurgeOutcome.NOT_IN_CDP:
      return Boom.notFound(`Client '${clientId}' not found in CDP`)
    case PurgeOutcome.NAME_REUSED:
      return Boom.conflict(
        "The stored client is out of date: its name belongs to a different client, and that client's older secrets may have been removed"
      )
    case PurgeOutcome.NAME_SHARED:
      return Boom.conflict(
        'Another client has the same name, so no secret was removed'
      )
    case PurgeOutcome.OUTCOME_UNKNOWN:
      return badGateway(PURGE_OUTCOME_UNKNOWN_MESSAGE, 'unknown')
    default:
      throw new Error(`Unknown purge outcome: ${outcome}`)
  }
}

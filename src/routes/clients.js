import Boom from '@hapi/boom'
import Joi from 'joi'
import { clientSchema } from '#/common/helpers/validation.js'
import { findClient, findClients, saveClient } from '#/services/clients.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { managedServices } from '#/common/helpers/managed-services.js'
import { sync } from '#/services/client-sync.js'
import { deleteClient } from '#/services/client-delete.js'
import { purgeOldSecret } from '#/services/client-purge.js'
import { PurgeOutcome } from '#/domain/client-secrets.js'
import {
  toClientRecord,
  toClientResponse,
  toClientCredentialsResponse
} from '#/models/client-mapper.js'
import {
  createCognitoCredential,
  rotateCognitoCredential,
  CdpError,
  deleteCognitoCredential,
  allCognitoCredentials
} from '#/common/helpers/cognito-client.js'

// A retry rotates again, and a client holds at most two secrets, so
// retrying blind can remove the secret the caller still uses. Per the CDP
// docs ("Rotate client credentials"): "A new secret is issued and the existing
// secret is retained... If it already has two, the oldest is removed to make
// room." https://github.com/DEFRA/cdp-documentation/blob/main/how-to/managing_cognito_credentials.md
const OUTCOME_UNKNOWN_MESSAGE =
  'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'

// CDP returns a new client's secret only once, and a retry is skipped as a
// duplicate, so the caller can only get a secret by rotating
const CREATE_OUTCOME_UNKNOWN_MESSAGE =
  "Create outcome unknown: the client may have been created, but its secret couldn't be returned. It won't be listed until the next sync (or POST /clients/sync). If it exists then, rotate its secret."

// Purging is idempotent, and the newest secret is always kept, so a retry
// can't leave the client without a secret
const PURGE_OUTCOME_UNKNOWN_MESSAGE =
  'Purge outcome unknown: the older secret may have been removed. It is safe to try again: if the client then has only one secret, the purge worked.'

// CDP service names are lowercase kebab-case; Cognito client ids match [\w+]+
const clientParamsSchema = Joi.object({
  tenantServiceName: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .required(),
  clientId: Joi.string()
    .pattern(/^[\w+]+$/)
    .required()
})

const logger = createLogger()

/**
 * @param {string} clientName
 * @returns {Boom.Boom} A 409 naming the client
 */
function clientNameTaken(clientName) {
  return Boom.conflict(
    `Client name '${clientName}' already exists (case insensitive)`
  )
}

/**
 * @param {string} tenantServiceName
 * @param {string} clientId
 * @returns {Boom.Boom} A 404 naming the client and service
 */
function clientNotFound(tenantServiceName, clientId) {
  return Boom.notFound(
    `Client '${clientId}' not found for tenant service '${tenantServiceName}'`
  )
}

/**
 * @param {string} outcome - A PurgeOutcome other than PURGED
 * @param {{ clientId: string, clientName: string }} client
 * @returns {Boom.Boom} The error for the outcome
 */
function purgeError(outcome, { clientId, clientName }) {
  switch (outcome) {
    case PurgeOutcome.NOT_IN_CDP:
      return Boom.notFound(`Client '${clientId}' not found in CDP`)
    case PurgeOutcome.NAME_OUT_OF_DATE:
      return Boom.conflict(
        "The stored client is out of date: its name doesn't match CDP"
      )
    case PurgeOutcome.NAME_REUSED:
      return Boom.conflict(
        'The stored client is out of date: its name belongs to a different client'
      )
    case PurgeOutcome.NAME_SHARED:
      return Boom.conflict(
        `Another client is named '${clientName}' (case insensitive), and CDP removes secrets by name, so no secret was removed`
      )
    case PurgeOutcome.ONE_SECRET:
      return Boom.conflict(
        `Client '${clientId}' has only one secret, so there is none to remove`
      )
    case PurgeOutcome.SAME_TIME:
      return Boom.conflict(
        `Client '${clientId}' has two secrets created at the same time, so neither is older to remove`
      )
    case PurgeOutcome.LIST_UNREADABLE:
    case PurgeOutcome.NO_SECRETS:
    case PurgeOutcome.DATE_UNREADABLE:
      return Boom.badGateway(
        "Couldn't read the client's secrets from CDP, so no secret was removed"
      )
    case PurgeOutcome.OUTCOME_UNKNOWN:
      return Boom.badGateway(PURGE_OUTCOME_UNKNOWN_MESSAGE)
    default:
      throw new Error(`Unknown purge outcome: ${outcome}`)
  }
}

// CDP doesn't validate service names, so an unknown one fails there with an
// unhelpful 400 or 500. Only the services this service syncs are managed here
const checkTenantService = {
  method: (request, h) => {
    const { tenantServiceName } = request.params

    if (!managedServices().includes(tenantServiceName)) {
      return Boom.notFound(
        `Tenant service '${tenantServiceName}' is not managed by dwt-client-sync`
      )
    }

    return h.continue
  }
}

export const clients = [
  {
    method: 'POST',
    path: '/clients/sync',
    handler: async (request, h) => {
      try {
        const { db, locker } = request

        logger.info('Sync client called')

        const result = await sync(db, locker)

        return h.response({
          result
        })
      } catch (err) {
        logger.error(err.message)
        return Boom.internal()
      }
    }
  },
  {
    method: 'GET',
    path: '/clients/{tenantServiceName}/{clientId}',
    options: {
      pre: [checkTenantService]
    },
    handler: async (request, h) => {
      try {
        const {
          db,
          params: { tenantServiceName, clientId }
        } = request
        const client = await findClient(tenantServiceName, clientId, db)

        if (!client) {
          return clientNotFound(tenantServiceName, clientId)
        }

        return h.response(toClientResponse(client))
      } catch (err) {
        logger.error(err.message)
        return Boom.internal()
      }
    }
  },
  {
    method: 'GET',
    path: '/clients/{tenantServiceName}',
    options: {
      pre: [checkTenantService]
    },
    handler: async (request, h) => {
      try {
        const {
          db,
          params: { tenantServiceName }
        } = request
        // Unknown services are already rejected, so no clients is just empty
        const clientRecords = await findClients(tenantServiceName, db)

        return h.response(clientRecords.map(toClientResponse))
      } catch (err) {
        logger.error(err.message)
        return Boom.internal()
      }
    }
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}',
    options: {
      validate: {
        payload: clientSchema
      },
      pre: [checkTenantService],
      // Responses can hold a client secret
      cache: {
        otherwise: 'no-store'
      }
    },
    handler: async (request, h) => {
      try {
        const {
          db,
          payload,
          params: { tenantServiceName }
        } = request
        // Check if a client with that name already exists
        // Comparision is case insensitive
        // e.g. client-name == Client-Name == cLieNt-NAmE
        let existingClients
        try {
          existingClients = await allCognitoCredentials(tenantServiceName)
        } catch (err) {
          logger.error(`Listing clients before create failed: ${err.message}`)
        }

        // Without the existing clients, a duplicate name can't be ruled out
        if (!existingClients) {
          return Boom.badGateway(
            "Couldn't check the existing client names in CDP, so no client was created"
          )
        }

        const requestedName = payload.clientName.toLowerCase()
        const isDuplicate = existingClients.some(
          (client) => client.clientName?.toLowerCase() === requestedName
        )
        if (isDuplicate) {
          return clientNameTaken(payload.clientName)
        }

        // Send creation request to cognito
        let createdClients
        try {
          createdClients = await createCognitoCredential(
            tenantServiceName,
            payload.clientName
          )
        } catch (err) {
          if (err instanceof CdpError) {
            return err.outcomeUnknown
              ? Boom.badGateway(CREATE_OUTCOME_UNKNOWN_MESSAGE)
              : Boom.badGateway(
                  'CDP refused the create request, so no client was created'
                )
          }
          throw err
        }

        // A success response we can't read: CDP may still have created it
        if (!Array.isArray(createdClients)) {
          logger.error("CDP's create response has no client details")
          return Boom.badGateway(CREATE_OUTCOME_UNKNOWN_MESSAGE)
        }

        // CDP skips names that already exist, so nothing was created
        if (createdClients.length === 0) {
          return clientNameTaken(payload.clientName)
        }

        const createdClient = createdClients.find(
          (client) => client.clientName === payload.clientName
        )

        if (!createdClient?.clientId) {
          logger.error("CDP's create response doesn't include the client")
          return Boom.badGateway(CREATE_OUTCOME_UNKNOWN_MESSAGE)
        }

        // Stored now, rather than at the next sync, so it can be found and
        // rotated straight away
        try {
          await saveClient(db, toClientRecord(createdClient, tenantServiceName))
        } catch (err) {
          // The secret can't be retrieved later, so it's still returned. The
          // next sync stores the client
          logger.error(`Saving created client failed: ${err.message}`)
        }

        if (!createdClient.clientSecret) {
          logger.error("CDP's create response has no secret for the client")
          return Boom.badGateway(CREATE_OUTCOME_UNKNOWN_MESSAGE)
        }

        // Only time the secret is available, so it must be returned
        return h.response(toClientCredentialsResponse(createdClient))
      } catch (err) {
        logger.error(err.message)
        return Boom.internal()
      }
    }
  },
  {
    method: 'DELETE',
    path: '/clients/{tenantServiceName}/{clientId}',
    options: {
      pre: [checkTenantService]
    },
    handler: async (request, h) => {
      try {
        const {
          db,
          auth,
          params: { tenantServiceName, clientId }
        } = request
        logger.info(`Client deletion requested by ${auth.credentials.username}`)

        const client = await findClient(tenantServiceName, clientId, db)

        if (!client) {
          return clientNotFound(tenantServiceName, clientId)
        }

        await deleteCognitoCredential(tenantServiceName, client.clientName)

        try {
          await deleteClient(db, clientId, tenantServiceName)
        } catch (err) {
          // If credential deletion succeeds but sync fails, log error, but still return 'success'
          // Scheduled sync should fix the cache later
          logger.error(
            `Deleting client from cache failed with error: ${err.message}`
          )
        }

        return h.response()
      } catch (err) {
        logger.error(`Deleting client failed with error: ${err.message}`)
        return Boom.internal()
      }
    }
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}/{clientId}/rotate',
    options: {
      validate: {
        params: clientParamsSchema
      },
      pre: [checkTenantService],
      // Responses can hold a client secret
      cache: {
        otherwise: 'no-store'
      }
    },
    handler: async (request, h) => {
      try {
        const {
          db,
          auth,
          params: { tenantServiceName, clientId }
        } = request

        logger.info(
          `Client secret rotation requested by ${auth.credentials.username} for client ${clientId} of ${tenantServiceName}`
        )

        // Cognito rotates by client name, which the stored client gives us
        const client = await findClient(tenantServiceName, clientId, db)

        if (!client) {
          return clientNotFound(tenantServiceName, clientId)
        }

        const rotatedClients = await rotateCognitoCredential(
          tenantServiceName,
          client.clientName
        )

        // A success response we can't read: CDP may still have rotated
        if (!Array.isArray(rotatedClients)) {
          logger.error(
            `CDP's rotate response for client ${clientId} has no client details`
          )
          return Boom.badGateway(OUTCOME_UNKNOWN_MESSAGE)
        }

        // CDP skips clients it doesn't know, leaving nothing rotated
        if (rotatedClients.length === 0) {
          logger.error(`Cognito did not rotate client ${clientId}`)
          return Boom.notFound()
        }

        // Names aren't unique in Cognito, so pick out this client
        const rotatedClient = rotatedClients.find(
          (rotated) => rotated.clientId === clientId
        )

        const otherRotatedClients = rotatedClients.filter(
          (rotated) => rotated.clientId !== clientId
        )
        if (otherRotatedClients.length > 0) {
          logger.warn(
            `Rotating client ${clientId} also rotated ${otherRotatedClients.length} other client(s) with the same name`
          )
        }

        // CDP rotated other clients with the stored name, but not this one
        if (!rotatedClient) {
          logger.error(
            `Client ${clientId} is out of date: its name belongs to a different client in Cognito`
          )
          return Boom.conflict(
            'The stored client is out of date: its name belongs to a different client'
          )
        }

        logger.info(
          `Rotated client secret for client ${clientId} of ${tenantServiceName}`
        )

        // Only time the new secret is available, so it must be returned
        return h.response(toClientCredentialsResponse(rotatedClient))
      } catch (err) {
        logger.error(err.message)

        if (err instanceof CdpError) {
          return err.outcomeUnknown
            ? Boom.badGateway(OUTCOME_UNKNOWN_MESSAGE)
            : Boom.badGateway('CDP refused the rotation request')
        }

        return Boom.internal()
      }
    }
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}/{clientId}/purge',
    options: {
      validate: {
        params: clientParamsSchema
      },
      pre: [checkTenantService]
    },
    handler: async (request, h) => {
      try {
        const {
          db,
          auth,
          params: { tenantServiceName, clientId }
        } = request

        logger.info(
          `Old client secret purge requested by ${auth.credentials.username} for client ${clientId} of ${tenantServiceName}`
        )

        // Only stored clients are managed here
        const client = await findClient(tenantServiceName, clientId, db)

        if (!client) {
          return clientNotFound(tenantServiceName, clientId)
        }

        const outcome = await purgeOldSecret(tenantServiceName, client)

        if (outcome !== PurgeOutcome.PURGED) {
          return purgeError(outcome, client)
        }

        return h.response().code(204)
      } catch (err) {
        logger.error(err.message)

        if (err instanceof CdpError) {
          return err.outcomeUnknown
            ? Boom.badGateway(PURGE_OUTCOME_UNKNOWN_MESSAGE)
            : Boom.badGateway(
                'CDP refused the purge request, so no secret was removed'
              )
        }

        return Boom.internal()
      }
    }
  }
]

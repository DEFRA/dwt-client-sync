import Boom from '@hapi/boom'
import Joi from 'joi'
import { clientSchema } from '#/common/helpers/validation.js'
import { findClient, findClients } from '#/services/clients.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { managedServices } from '#/common/helpers/managed-services.js'
import { sync } from '#/services/client-sync.js'
import { deleteClient } from '#/services/client-delete.js'
import {
  toClientResponse,
  toClientCredentialsResponse
} from '#/models/client-mapper.js'
import {
  createCognitoCredential,
  rotateCognitoCredential,
  purgeCognitoCredential,
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
  "Create outcome unknown: the client may have been created, but its secret couldn't be returned. Check the client, and rotate its secret if it exists."

const SECRETS_UNREADABLE_MESSAGE =
  "Couldn't read the client's secrets from CDP, so no secret was removed"

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
          locker,
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

        // Sync
        logger.info('Sync client called')
        try {
          await sync(db, locker)
        } catch (err) {
          // If credential creation succeeds but sync fails, log error, but still return 'success'
          // Credential secrets cannot be retrieved later so must be returned
          // Scheduled sync should fix the cache later
          logger.error(`Sync failed with error: ${err.message}`)
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

        if (!createdClient?.clientSecret) {
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

        // Only the list says how many secrets the client has
        let cognitoClients
        try {
          cognitoClients = await allCognitoCredentials(tenantServiceName)
        } catch (err) {
          logger.error(`Listing clients before purge failed: ${err.message}`)
        }

        if (!cognitoClients) {
          return Boom.badGateway(SECRETS_UNREADABLE_MESSAGE)
        }

        const cognitoClient = cognitoClients.find(
          (listed) => listed.clientId === clientId
        )

        if (!cognitoClient) {
          return Boom.notFound(`Client '${clientId}' not found in CDP`)
        }

        if (cognitoClient.clientName !== client.clientName) {
          logger.error(
            `Client ${clientId} is out of date: its name in Cognito has changed`
          )
          return Boom.conflict(
            "The stored client is out of date: its name doesn't match CDP"
          )
        }

        // Names aren't unique in Cognito, and CDP purges every client with
        // the name, so a purge would also remove the other clients' secrets.
        // CDP's docs don't say whether names match case insensitively, so
        // assume they do
        const name = client.clientName.toLowerCase()
        const sharesName = cognitoClients.some(
          (listed) =>
            listed.clientName?.toLowerCase() === name &&
            listed.clientId !== clientId
        )

        if (sharesName) {
          logger.error(
            `Not purging client ${clientId}: another client has the same name`
          )
          return Boom.conflict(
            `Another client is named '${client.clientName}' (case insensitive), and CDP removes secrets by name, so no secret was removed`
          )
        }

        const { secrets } = cognitoClient

        // CDP never removes a client's newest secret, so none means the list
        // can't be trusted
        if (!Array.isArray(secrets) || secrets.length === 0) {
          logger.error(`CDP's list has no secrets for client ${clientId}`)
          return Boom.badGateway(SECRETS_UNREADABLE_MESSAGE)
        }

        // A client must always keep a secret
        if (secrets.length === 1) {
          return Boom.conflict(
            `Client '${clientId}' has only one secret, so there is none to remove`
          )
        }

        const sorted = newestFirst(secrets)

        if (!sorted) {
          logger.error(
            `CDP's list has a secret for client ${clientId} with an unreadable creation date`
          )
          return Boom.badGateway(SECRETS_UNREADABLE_MESSAGE)
        }

        const [newest, nextNewest] = sorted

        // Created in the same millisecond, neither secret is before the
        // other's cutoff, so CDP would remove nothing
        if (newest.time === nextNewest.time) {
          return Boom.conflict(
            `Client '${clientId}' has two secrets created at the same time, so neither is older to remove`
          )
        }

        // CDP only removes secrets created before the cutoff, so the newest
        // secret we listed is kept, and so is any secret from a rotation
        // since
        const purgedClients = await purgeCognitoCredential(
          tenantServiceName,
          client.clientName,
          newest.secret.createdAt
        )

        // A success response we can't read: CDP may still have purged
        if (!Array.isArray(purgedClients)) {
          logger.error(
            `CDP's purge response for client ${clientId} has no client details`
          )
          return Boom.badGateway(PURGE_OUTCOME_UNKNOWN_MESSAGE)
        }

        // CDP skips clients it doesn't know, leaving nothing purged
        if (purgedClients.length === 0) {
          logger.error(`Cognito did not purge client ${clientId}`)
          return Boom.notFound(`Client '${clientId}' not found in CDP`)
        }

        const otherPurgedClients = purgedClients.filter(
          (purged) => purged.clientId !== clientId
        )
        if (otherPurgedClients.length > 0) {
          logger.error(
            `Purging client ${clientId} also purged ${otherPurgedClients.length} other client(s) with the same name`
          )
        }

        // CDP purged other clients with the stored name, but not this one
        if (!purgedClients.some((purged) => purged.clientId === clientId)) {
          logger.error(
            `Client ${clientId} is out of date: its name belongs to a different client in Cognito`
          )
          return Boom.conflict(
            'The stored client is out of date: its name belongs to a different client'
          )
        }

        logger.info(
          `Purged old client secrets for client ${clientId} of ${tenantServiceName}`
        )

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

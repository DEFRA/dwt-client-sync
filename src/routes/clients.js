import Boom from '@hapi/boom'
import Joi from 'joi'
import { clientSchema } from '#/common/helpers/validation.js'
import { findClient, findClients } from '#/services/clients.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'
import { deleteClient } from '#/services/client-delete.js'
import {
  createCognitoCredential,
  rotateCognitoCredential,
  RotationError,
  deleteCognitoCredential,
  allCognitoCredentials
} from '#/common/helpers/cognito-client.js'

// A retry rotates again, and a client holds at most two secrets, so
// retrying blind can remove the secret the caller still uses. Per the CDP
// portal API docs ("Rotate client credentials"): "A new secret is issued and
// the existing secret is retained... If it already has two, the oldest is
// removed to make room." TODO: link the page once I have portal access
const OUTCOME_UNKNOWN_MESSAGE =
  'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'

// CDP service names are lowercase kebab-case; Cognito client ids match [\w+]+
const rotateParamsSchema = Joi.object({
  tenantServiceName: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .required(),
  clientId: Joi.string()
    .pattern(/^[\w+]+$/)
    .required()
})

const logger = createLogger()

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
    handler: async (request, h) => {
      try {
        const {
          db,
          params: { tenantServiceName, clientId }
        } = request
        const client = await findClient(tenantServiceName, clientId, db)

        if (!client) {
          return Boom.notFound()
        }

        return h.response(client)
      } catch (err) {
        logger.error(err.message)
        return Boom.internal()
      }
    }
  },
  {
    method: 'GET',
    path: '/clients/{tenantServiceName}',
    handler: async (request, h) => {
      try {
        const {
          db,
          params: { tenantServiceName }
        } = request
        const clientRecords = await findClients(tenantServiceName, db)

        if (clientRecords.length === 0) {
          return Boom.notFound()
        }

        return h.response(clientRecords)
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
        const allCredentials = await allCognitoCredentials(tenantServiceName)
        const requestedName = payload.clientName.toLowerCase()

        if (allCredentials?.client_details) {
          const isDuplicate = allCredentials.client_details.some(
            (detail) => detail.client_name.toLowerCase() === requestedName
          )
          if (isDuplicate) {
            return Boom.conflict(
              `Client name '${requestedName}' already exists (case insensitive)`
            )
          }
        }

        // Send creation request to cognito
        const credentials = await createCognitoCredential(
          tenantServiceName,
          payload.clientName
        )

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

        // Return credentials
        const clientDetails = credentials?.['client_details']?.[0]
        return h.response({
          ...clientDetails
        })
      } catch (err) {
        logger.error(err.message)
        return Boom.internal()
      }
    }
  },
  {
    method: 'DELETE',
    path: '/clients/{tenantServiceName}/{clientId}',
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
          return Boom.notFound()
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
        return Boom.internal()
      }
    }
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}/{clientId}/rotate',
    options: {
      validate: {
        params: rotateParamsSchema
      },
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
          return Boom.notFound()
        }

        const credentials = await rotateCognitoCredential(
          tenantServiceName,
          client.clientName
        )

        const rotatedClients = credentials?.['client_details']

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
        const clientDetails = rotatedClients.find(
          (details) => details.client_id === clientId
        )

        const otherRotatedClients = rotatedClients.filter(
          (details) => details.client_id !== clientId
        )
        if (otherRotatedClients.length > 0) {
          logger.warn(
            `Rotating client ${clientId} also rotated ${otherRotatedClients.length} other client(s) with the same name`
          )
        }

        // CDP rotated other clients with the stored name, but not this one
        if (!clientDetails) {
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
        return h.response({
          ...clientDetails
        })
      } catch (err) {
        logger.error(err.message)

        if (err instanceof RotationError) {
          return err.outcomeUnknown
            ? Boom.badGateway(OUTCOME_UNKNOWN_MESSAGE)
            : Boom.badGateway('CDP refused the rotation request')
        }

        return Boom.internal()
      }
    }
  }
]

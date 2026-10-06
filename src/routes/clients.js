import Boom from '@hapi/boom'
import Joi from 'joi'
import { findClient, findClients } from '#/services/clients.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'
import {
  rotateCognitoCredential,
  RotationError
} from '#/common/helpers/cognito-client.js'

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

        // Names aren't unique in Cognito, so pick out this client. Cognito
        // skips clients it doesn't know, leaving no matching entry
        const rotatedClients = credentials?.['client_details'] ?? []
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

        if (!clientDetails) {
          logger.error(`Cognito did not rotate client ${clientId}`)
          return Boom.notFound()
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
          // A retry rotates again, and a client holds at most two secrets,
          // so retrying blind can remove the secret the caller still uses
          return err.outcomeUnknown
            ? Boom.badGateway(
                'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'
              )
            : Boom.badGateway('CDP refused the rotation request')
        }

        return Boom.internal()
      }
    }
  }
]

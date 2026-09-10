import Boom from '@hapi/boom'
import { findClient } from '#/services/clients.js'
import { findAllUserPoolClients } from '#/services/cognito-clients.js'
import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()

export const clients = [
  {
    method: 'GET',
    path: '/clients/{userPoolId}/{clientId}',
    handler: async (request, h) => {
      try {
        const {
          db,
          params: { userPoolId, clientId }
        } = request
        const client = await findClient(userPoolId, clientId, db)

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
    path: '/clients/{userPoolId}',
    handler: async (request, h) => {
      try {
        const entities = await findAllUserPoolClients(request.params.userPoolId)
        return h.response(entities)
      } catch (error) {
        if (error.name === 'ResourceNotFoundException') {
          return h.response().code(404)
        }
        throw error
      }
    }
  }
]

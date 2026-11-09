import Boom from '@hapi/boom'

import { createLogger } from '#/common/helpers/logging/logger.js'
import { findClient } from '#/services/clients.js'
import { toClientResponse } from '#/models/client-mapper.js'
import { clientNotFound } from '#/routes/handlers/common.js'

const logger = createLogger()

export async function getClientHandler(request, h) {
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

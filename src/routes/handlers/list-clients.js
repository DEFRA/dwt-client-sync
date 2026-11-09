import Boom from '@hapi/boom'

import { createLogger } from '#/common/helpers/logging/logger.js'
import { findClients } from '#/services/clients.js'
import { toClientResponse } from '#/models/client-mapper.js'

const logger = createLogger()

export async function listClientsHandler(request, h) {
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

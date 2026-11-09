import Boom from '@hapi/boom'

import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'

const logger = createLogger()

export async function syncClientsHandler(request, h) {
  try {
    const { db, locker } = request

    logger.info('Sync client called')

    const result = await sync(db, locker)

    return h.response({ result })
  } catch (err) {
    logger.error(err.message)
    return Boom.internal()
  }
}

import Boom from '@hapi/boom'

import { createLogger } from '#/common/helpers/logging/logger.js'
import { sync } from '#/services/client-sync.js'

const logger = createLogger()

/**
 * POST /clients/sync: brings the stored clients up to date with CDP, as the
 * scheduled sync does
 * @param {import('@hapi/hapi').Request} request - The request
 * @param {import('@hapi/hapi').ResponseToolkit} h - The response toolkit
 * @returns {Promise<import('@hapi/hapi').ResponseObject | import('@hapi/boom').Boom>} How
 * many clients were synced for each service, or none if another instance is
 * already syncing
 */
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

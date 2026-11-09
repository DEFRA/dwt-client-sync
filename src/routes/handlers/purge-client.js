import Boom from '@hapi/boom'

import {
  CdpError,
  getCognitoCredential
} from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { PurgeOutcome } from '#/domain/client-secrets.js'
import { toClientRecord } from '#/models/client-mapper.js'
import {
  cdpFailed,
  clientNotFound,
  purgeError,
  PURGE_OUTCOME_UNKNOWN_MESSAGE
} from '#/routes/handlers/common.js'
import { purgeOldSecret } from '#/services/client-purge.js'
import { findClient, saveClient } from '#/services/clients.js'

const logger = createLogger()
const HTTP_STATUS_CODES = {
  NO_CONTENT: 204
}

export async function purgeClientHandler(request, h) {
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

    // CDP has purged, so a failure here mustn't make it look as if it didn't.
    // The next sync corrects the stored secrets
    try {
      const { secrets } = await getCognitoCredential(
        tenantServiceName,
        clientId
      )
      await saveClient(
        db,
        toClientRecord({ ...client, secrets }, tenantServiceName)
      )
    } catch (err) {
      logger.error(
        `Updating client ${clientId}'s stored secrets after purging failed: ${err.message}`
      )
    }

    return h.response().code(HTTP_STATUS_CODES.NO_CONTENT)
  } catch (err) {
    logger.error(err.message)

    if (err instanceof CdpError) {
      return cdpFailed(
        err,
        PURGE_OUTCOME_UNKNOWN_MESSAGE,
        'CDP refused the purge request, so no secret was removed'
      )
    }

    return Boom.internal()
  }
}

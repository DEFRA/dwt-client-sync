import Boom from '@hapi/boom'

import { CdpError } from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { findClient } from '#/services/clients.js'
import { rotateSecret, saveRotatedClient } from '#/services/client-rotate.js'
import { RotateOutcome } from '#/domain/client-secrets.js'
import { toClientCredentialsResponse } from '#/models/client-mapper.js'
import {
  cdpFailed,
  clientNotFound,
  rotateError,
  OUTCOME_UNKNOWN_MESSAGE
} from '#/routes/handlers/common.js'

const logger = createLogger()

export async function rotateClientHandler(request, h) {
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

    const { outcome, rotatedClient } = await rotateSecret(
      tenantServiceName,
      client
    )

    if (outcome !== RotateOutcome.ROTATED) {
      return rotateError(outcome)
    }

    await saveRotatedClient(db, tenantServiceName, rotatedClient)

    // Only time the new secret is available, so it must be returned
    return h.response(toClientCredentialsResponse(rotatedClient))
  } catch (err) {
    logger.error(err.message)

    if (err instanceof CdpError) {
      return cdpFailed(
        err,
        OUTCOME_UNKNOWN_MESSAGE,
        'CDP refused the rotation request'
      )
    }

    return Boom.internal()
  }
}

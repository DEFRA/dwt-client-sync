import Boom from '@hapi/boom'

import { CdpError } from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { findClient } from '#/services/clients.js'
import { replaceSecret } from '#/services/client-replace.js'
import { saveRotatedClient } from '#/services/client-rotate.js'
import { isRotateOutcome, ReplaceOutcome } from '#/domain/client-secrets.js'
import { toClientCredentialsResponse } from '#/models/client-mapper.js'
import {
  badGateway,
  cdpFailed,
  clientNotFound,
  rotateError,
  REPLACE_OLD_SECRET_KEPT_MESSAGE,
  REPLACE_OUTCOME_UNKNOWN_MESSAGE
} from '#/routes/handlers/common.js'

const logger = createLogger()

export async function replaceClientHandler(request, h) {
  try {
    const {
      db,
      auth,
      params: { tenantServiceName, clientId }
    } = request

    logger.info(
      `Client secret replacement requested by ${auth.credentials.username} for client ${clientId} of ${tenantServiceName}`
    )

    // Cognito rotates and purges by client name, which the stored client gives us
    const client = await findClient(tenantServiceName, clientId, db)

    if (!client) {
      return clientNotFound(tenantServiceName, clientId)
    }

    const { outcome, rotatedClient } = await replaceSecret(
      tenantServiceName,
      client
    )

    if (outcome === ReplaceOutcome.NAME_SHARED) {
      return Boom.conflict(
        'Another client has the same name, so no secret was replaced'
      )
    }

    if (isRotateOutcome(outcome)) {
      return rotateError(outcome, REPLACE_OUTCOME_UNKNOWN_MESSAGE)
    }

    await saveRotatedClient(db, tenantServiceName, rotatedClient)

    const credentials = toClientCredentialsResponse(rotatedClient)

    // The purge didn't confirm the old secret is gone. The new secret can't be
    // fetched again, so it's returned with the error
    if (outcome !== ReplaceOutcome.REPLACED) {
      return badGateway(
        REPLACE_OLD_SECRET_KEPT_MESSAGE,
        outcome === ReplaceOutcome.PURGE_OUTCOME_UNKNOWN
          ? 'unknown'
          : 'failure',
        credentials
      )
    }

    // Only time the new secret is available, so it must be returned
    return h.response(credentials)
  } catch (err) {
    logger.error(err.message)

    if (err instanceof CdpError) {
      return cdpFailed(
        err,
        REPLACE_OUTCOME_UNKNOWN_MESSAGE,
        'CDP refused the rotation request, so no secret was replaced'
      )
    }

    return Boom.internal()
  }
}

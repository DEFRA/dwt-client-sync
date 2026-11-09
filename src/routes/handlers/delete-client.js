import Boom from '@hapi/boom'

import {
  CdpError,
  deleteCognitoCredential
} from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { sharesExactName } from '#/domain/client-names.js'
import {
  cdpFailed,
  clientNotFound,
  DELETE_OUTCOME_UNKNOWN_MESSAGE
} from '#/routes/handlers/common.js'
import { deleteClient } from '#/services/client-delete.js'
import { listClients } from '#/services/client-directory.js'
import { findClient } from '#/services/clients.js'

const logger = createLogger()

export async function deleteClientHandler(request, h) {
  try {
    const {
      db,
      auth,
      params: { tenantServiceName, clientId }
    } = request
    logger.info(
      `Client deletion requested by ${auth.credentials.username} for client ${clientId} of ${tenantServiceName}`
    )

    const client = await findClient(tenantServiceName, clientId, db)

    if (!client) {
      return clientNotFound(tenantServiceName, clientId)
    }

    const clients = await listClients(tenantServiceName)

    // A client already gone from Cognito, as after a retry, only has its
    // stored record left. CDP isn't asked, as it deletes by name, and
    // another client may have been given the name since
    if (clients.some((other) => other.clientId === clientId)) {
      // CDP deletes by exact name, so another client with exactly this
      // name could be deleted instead
      if (sharesExactName(clients, client)) {
        logger.error(
          `Not deleting client ${clientId}: another client has the same name`
        )
        return Boom.conflict(
          'Another client has the same name, so nothing was deleted'
        )
      }

      await deleteCognitoCredential(tenantServiceName, client.clientName)
    } else {
      logger.info(
        `Client ${clientId} is already gone from Cognito, so only its stored record is deleted`
      )
    }

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
    logger.error(`Deleting client failed with error: ${err.message}`)

    if (err instanceof CdpError) {
      return cdpFailed(
        err,
        DELETE_OUTCOME_UNKNOWN_MESSAGE,
        'The delete request was refused, so nothing was deleted'
      )
    }

    return Boom.internal()
  }
}

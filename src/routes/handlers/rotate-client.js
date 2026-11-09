import Boom from '@hapi/boom'

import {
  CdpError,
  getCognitoCredential,
  rotateCognitoCredential
} from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { findClient, saveClient } from '#/services/clients.js'
import {
  toClientRecord,
  toClientCredentialsResponse
} from '#/models/client-mapper.js'
import {
  badGateway,
  cdpFailed,
  clientNotFound,
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

    const rotatedClients = await rotateCognitoCredential(
      tenantServiceName,
      client.clientName
    )

    // A success response we can't read: CDP may still have rotated
    if (!Array.isArray(rotatedClients)) {
      logger.error(
        `CDP's rotate response for client ${clientId} has no client details`
      )
      return badGateway(OUTCOME_UNKNOWN_MESSAGE, 'unknown')
    }

    // CDP skips clients it doesn't know, leaving nothing rotated
    if (rotatedClients.length === 0) {
      logger.error(`Cognito did not rotate client ${clientId}`)
      return Boom.notFound()
    }

    // Names aren't unique in Cognito, so pick out this client
    const rotatedClient = rotatedClients.find(
      (rotated) => rotated.clientId === clientId
    )

    const otherRotatedClients = rotatedClients.filter(
      (rotated) => rotated.clientId !== clientId
    )
    if (otherRotatedClients.length > 0) {
      logger.warn(
        `Rotating client ${clientId} also rotated ${otherRotatedClients.length} other client(s) with the same name`
      )
    }

    // CDP rotated other clients with the stored name, but not this one
    if (!rotatedClient) {
      logger.error(
        `Client ${clientId} is out of date: its name belongs to a different client in Cognito`
      )
      return Boom.conflict(
        'The stored client is out of date: its name belongs to a different client'
      )
    }

    logger.info(
      `Rotated client secret for client ${clientId} of ${tenantServiceName}`
    )

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

async function saveRotatedClient(db, tenantServiceName, rotatedClient) {
  let secrets

  try {
    ;({ secrets } = await getCognitoCredential(
      tenantServiceName,
      rotatedClient.clientId
    ))
  } catch (err) {
    logger.error(`Failed to fetch credential metadata: ${err.message}`)
    return
  }

  try {
    await saveClient(
      db,
      toClientRecord({ ...rotatedClient, secrets }, tenantServiceName)
    )
  } catch (err) {
    logger.error(`Saving rotated client failed: ${err.message}`)
  }
}

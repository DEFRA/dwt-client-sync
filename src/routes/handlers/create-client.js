import Boom from '@hapi/boom'

import {
  CdpError,
  createCognitoCredential,
  getCognitoCredential
} from '#/common/helpers/cognito-client.js'
import { createLogger } from '#/common/helpers/logging/logger.js'
import { isNameTaken } from '#/domain/client-names.js'
import {
  toClientRecord,
  toClientCredentialsResponse
} from '#/models/client-mapper.js'
import {
  badGateway,
  cdpFailed,
  clientNameTaken,
  CREATE_NO_SECRET_MESSAGE,
  CREATE_OUTCOME_UNKNOWN_MESSAGE
} from '#/routes/handlers/common.js'
import { saveClient } from '#/services/clients.js'
import { listClients } from '#/services/client-directory.js'

const logger = createLogger()

export async function createClientHandler(request, h) {
  try {
    const {
      db,
      payload,
      params: { tenantServiceName }
    } = request
    // Names are unique ignoring case. CDP still skips an existing name
    const existingClients = await listClients(tenantServiceName)

    if (isNameTaken(existingClients, payload.clientName)) {
      return clientNameTaken(payload.clientName)
    }

    // Send creation request to cognito
    let createdClients
    try {
      createdClients = await createCognitoCredential(
        tenantServiceName,
        payload.clientName
      )
    } catch (err) {
      if (err instanceof CdpError) {
        return cdpFailed(
          err,
          CREATE_OUTCOME_UNKNOWN_MESSAGE,
          'CDP refused the create request, so no client was created'
        )
      }
      throw err
    }

    // A success response we can't read: CDP may still have created it
    if (!Array.isArray(createdClients)) {
      logger.error("CDP's create response has no client details")
      return badGateway(CREATE_OUTCOME_UNKNOWN_MESSAGE, 'unknown')
    }

    // CDP skips names that already exist, so nothing was created
    if (createdClients.length === 0) {
      return clientNameTaken(payload.clientName)
    }

    const createdClient = createdClients.find(
      (client) => client.clientName === payload.clientName
    )

    if (!createdClient?.clientId) {
      logger.error("CDP's create response doesn't include the client")
      return badGateway(CREATE_OUTCOME_UNKNOWN_MESSAGE, 'unknown')
    }

    const trySaveCreatedClient = async (secrets) => {
      try {
        await saveClient(
          db,
          toClientRecord({ ...createdClient, secrets }, tenantServiceName)
        )
      } catch (err) {
        logger.error(`Saving created client failed: ${err.message}`)
      }
    }

    try {
      // Fetch secret metadata that isn't initially returned
      const { secrets } = await getCognitoCredential(
        tenantServiceName,
        createdClient.clientId
      )
      await trySaveCreatedClient(secrets)
    } catch (err) {
      logger.error(`Failed to fetch credential metadata: ${err.message}`)
      // If secret metadata can't be fetched
      // Save client to database without secret metadata
      // Will be repopulated next sync.
      await trySaveCreatedClient()
    }

    if (!createdClient.clientSecret) {
      logger.error("CDP's create response has no secret for the client")
      return badGateway(CREATE_NO_SECRET_MESSAGE, 'success', {
        clientId: createdClient.clientId
      })
    }

    // Only time the secret is available, so it must be returned
    return h.response(toClientCredentialsResponse(createdClient))
  } catch (err) {
    logger.error(err.message)
    return Boom.internal()
  }
}

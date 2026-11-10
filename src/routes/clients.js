import Boom from '@hapi/boom'
import Joi from 'joi'

import { managedServices } from '#/common/helpers/managed-services.js'
import { clientSchema } from '#/common/helpers/validation.js'
import { createClientHandler } from '#/routes/handlers/create-client.js'
import { deleteClientHandler } from '#/routes/handlers/delete-client.js'
import { getClientHandler } from '#/routes/handlers/get-client.js'
import { listClientsHandler } from '#/routes/handlers/list-clients.js'
import { purgeClientHandler } from '#/routes/handlers/purge-client.js'
import { replaceClientHandler } from '#/routes/handlers/replace-client.js'
import { rotateClientHandler } from '#/routes/handlers/rotate-client.js'
import { syncClientsHandler } from '#/routes/handlers/sync-clients.js'

// CDP service names are lowercase kebab-case; Cognito client ids match [\w+]+
const clientParamsSchema = Joi.object({
  tenantServiceName: Joi.string()
    .pattern(/^[a-z0-9-]+$/)
    .required(),
  clientId: Joi.string()
    .pattern(/^[\w+]+$/)
    .required()
})

const checkTenantService = {
  method: (request, h) => {
    const { tenantServiceName } = request.params

    if (!managedServices().includes(tenantServiceName)) {
      return Boom.notFound(
        `Tenant service '${tenantServiceName}' is not managed by dwt-client-sync`
      )
    }

    return h.continue
  }
}

export const clients = [
  {
    method: 'POST',
    path: '/clients/sync',
    handler: syncClientsHandler
  },
  {
    method: 'GET',
    path: '/clients/{tenantServiceName}/{clientId}',
    options: {
      pre: [checkTenantService]
    },
    handler: getClientHandler
  },
  {
    method: 'GET',
    path: '/clients/{tenantServiceName}',
    options: {
      pre: [checkTenantService]
    },
    handler: listClientsHandler
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}',
    options: {
      validate: {
        payload: clientSchema
      },
      pre: [checkTenantService],
      cache: {
        otherwise: 'no-store'
      }
    },
    handler: createClientHandler
  },
  {
    method: 'DELETE',
    path: '/clients/{tenantServiceName}/{clientId}',
    options: {
      validate: {
        params: clientParamsSchema
      },
      pre: [checkTenantService]
    },
    handler: deleteClientHandler
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}/{clientId}/rotate',
    options: {
      validate: {
        params: clientParamsSchema
      },
      pre: [checkTenantService],
      cache: {
        otherwise: 'no-store'
      }
    },
    handler: rotateClientHandler
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}/{clientId}/purge',
    options: {
      validate: {
        params: clientParamsSchema
      },
      pre: [checkTenantService]
    },
    handler: purgeClientHandler
  },
  {
    method: 'POST',
    path: '/clients/{tenantServiceName}/{clientId}/replace',
    options: {
      validate: {
        params: clientParamsSchema
      },
      pre: [checkTenantService],
      // Responses can hold a client secret
      cache: {
        otherwise: 'no-store'
      }
    },
    handler: replaceClientHandler
  }
]

import {
  CognitoIdentityProviderClient,
  paginateListUserPoolClients
} from '@aws-sdk/client-cognito-identity-provider'
import { config } from '#/config.js'
import { managedServices } from '#/common/helpers/managed-services.js'

const { region, userPoolId, userPoolEndpoint } = config.get('cognito')

// Reads CDP's user pool directly, as listing it through CDP's API takes
// seconds a page. Changes still go through CDP's API. CDP gives each tenant
// service its own pool, named after the service, and creates clients under
// the name it's sent
// (https://github.com/DEFRA/cdp-mono-lambda/tree/main/modules/manage_tenant_service_user_pool)
const cognito = new CognitoIdentityProviderClient({
  region,
  ...(userPoolEndpoint && { endpoint: userPoolEndpoint })
})

/**
 * Lists every client in a tenant service's user pool, by id and name, without
 * secrets. Only one pool is configured, so it must be the only managed
 * service's.
 * @param {string} tenantServiceName
 * @returns {Promise<{ clientId: string, clientName: string }[]>}
 */
async function listUserPoolClients(tenantServiceName) {
  const services = managedServices()

  if (services.length !== 1 || services[0] !== tenantServiceName) {
    throw new Error(
      `The user pool is only configured for a single managed service, so can't read ${tenantServiceName}'s clients`
    )
  }

  const clients = []

  try {
    for await (const page of paginateListUserPoolClients(
      { client: cognito },
      { UserPoolId: userPoolId, MaxResults: 60 }
    )) {
      for (const { ClientId, ClientName } of page.UserPoolClients ?? []) {
        clients.push({ clientId: ClientId, clientName: ClientName })
      }
    }
  } catch (err) {
    throw new Error(`Reading user pool ${userPoolId} failed: ${err.message}`, {
      cause: err
    })
  }

  return clients
}

export { listUserPoolClients }

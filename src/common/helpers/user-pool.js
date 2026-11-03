import {
  CognitoIdentityProviderClient,
  paginateListUserPoolClients
} from '@aws-sdk/client-cognito-identity-provider'
import https from 'node:https'
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
  ...(userPoolEndpoint && { endpoint: userPoolEndpoint }),
  requestHandler: {
    // CDP only lets services reach AWS through its proxy. NODE_USE_ENV_PROXY
    // only covers Node's own agents, not the SDK's, so it's set here too
    httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: process.env }),
    connectionTimeout: 5_000,
    requestTimeout: 30_000
  }
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

  try {
    const pages = await Array.fromAsync(
      paginateListUserPoolClients(
        { client: cognito },
        { UserPoolId: userPoolId, MaxResults: 60 }
      )
    )

    return pages.flatMap((page) =>
      (page.UserPoolClients ?? []).map(({ ClientId, ClientName }) => ({
        clientId: ClientId,
        clientName: ClientName
      }))
    )
  } catch (err) {
    throw new Error(
      `Reading user pool ${userPoolId} failed: ${describeError(err)}`,
      { cause: err }
    )
  }
}

// A failed connection can be an AggregateError with an empty message, with
// the reasons in its errors
function describeError(err) {
  const reasons = [
    err?.message,
    ...(err?.errors ?? []).map((e) => e?.message)
  ].filter(Boolean)
  const details = reasons.length ? reasons.join('; ') : err?.code
  return [err?.name, details].filter(Boolean).join(': ') || String(err)
}

export { listUserPoolClients }

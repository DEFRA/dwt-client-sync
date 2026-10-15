import Wreck from '@hapi/wreck'
import { SignatureV4 } from '@aws-sdk/signature-v4'
import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { HttpRequest } from '@smithy/protocol-http'
import { Sha256 } from '@aws-crypto/sha256-js'
import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()
const {
  baseUrl,
  region,
  signerService,
  listClientsPath,
  createClientsPath,
  rotateClientsPath,
  deleteClientsPath,
  rotateTimeoutMs,
  protocol
} = config.get('cognito')

/**
 * A failed rotate request. `outcomeUnknown` is true when CDP may still have
 * issued a new secret (timeout, network error, 5xx or unreadable response),
 * and false when CDP refused the request (4xx), so nothing was rotated.
 */
class RotationError extends Error {
  constructor(message, { outcomeUnknown, cause }) {
    super(message, { cause })
    this.name = 'RotationError'
    this.outcomeUnknown = outcomeUnknown
  }
}

/**
 * A Cognito client, mapped from CDP's credentials API so nothing else here
 * depends on CDP's shape.
 * @typedef {object} CognitoClient
 * @property {string} clientId
 * @property {string} clientName
 * @property {string} [clientSecret] - Only sent when a client is created or rotated
 */

/**
 * Maps the clients in a CDP credentials response (snake_case) to Cognito
 * clients, dropping anything else CDP sends.
 * @param {{ client_details?: object[] }} payload
 * @returns {CognitoClient[] | undefined} undefined when the response has no client details
 */
function toCognitoClients(payload) {
  const clientDetails = payload?.client_details

  if (!Array.isArray(clientDetails)) {
    return undefined
  }

  return clientDetails.map(
    ({
      client_id: clientId,
      client_name: clientName,
      client_secret: clientSecret
    }) => ({
      clientId,
      clientName,
      ...(clientSecret !== undefined && { clientSecret })
    })
  )
}

const signer = new SignatureV4({
  credentials: defaultProvider(),
  region,
  service: signerService,
  sha256: Sha256
})

/**
 * @param {string} serviceName
 * @returns {Promise<CognitoClient[] | undefined>}
 */
async function allCognitoCredentials(serviceName) {
  logger.info('Fetching all Cognito credentials')

  const path = listClientsPath.replace('{service-name}', serviceName)

  const requestToSign = new HttpRequest({
    method: 'GET',
    protocol,
    hostname: baseUrl,
    path,
    headers: {
      host: baseUrl
    }
  })

  const signed = await signer.sign(requestToSign)

  logger.info(`${protocol}://${baseUrl}${path}`)

  const { res, payload } = await Wreck.get(`${protocol}://${baseUrl}${path}`, {
    headers: signed.headers,
    json: true
  })

  if (res.statusCode !== 200) {
    logger.error(
      `Failed to fetch Cognito credentials. Status code: ${res.statusCode}`
    )
    throw new Error(
      `Failed to fetch Cognito credentials. Status code: ${res.statusCode}`
    )
  }

  logger.info(
    'Successfully fetched all Cognito credentials from the backend service.'
  )

  return toCognitoClients(payload)
}

/**
 * @param {string} serviceName
 * @param {string} newClientName
 * @returns {Promise<CognitoClient[] | undefined>} The created client, with its secret
 */
async function createCognitoCredential(serviceName, newClientName) {
  logger.info('Creating new Cognito credentials')

  const path = createClientsPath.replace('{service-name}', serviceName)

  const requestToSign = new HttpRequest({
    method: 'POST',
    protocol,
    hostname: baseUrl,
    path,
    headers: {
      host: baseUrl,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_names: [newClientName]
    })
  })

  const signed = await signer.sign(requestToSign)

  const uri = `${protocol}://${baseUrl}${path}`

  logger.info(uri)

  const { res, payload } = await Wreck.post(uri, {
    headers: signed.headers,
    json: true,
    payload: signed.body
  })

  if (res.statusCode !== 200) {
    logger.error(
      `failed to create Cognito credentials.
      Status code: ${res.statusCode}`
    )
    throw new Error(
      `Failed to create Cognito credentials.
      Status code: ${res.statusCode}`
    )
  }

  logger.info(
    'Successfully created Cognito credentials from the backend service.'
  )

  return toCognitoClients(payload)
}

/**
 * @param {string} serviceName
 * @param {string} clientName
 * @returns {Promise<CognitoClient[] | undefined>} Every client rotated, with its new secret
 */
async function rotateCognitoCredential(serviceName, clientName) {
  logger.info('Rotating Cognito credentials')

  const path = rotateClientsPath.replace(
    '{service-name}',
    encodeURIComponent(serviceName)
  )

  // The body is signed as a string: SigV4 only hashes string or binary
  // bodies, and API Gateway checks the hash against what's actually sent
  const requestToSign = new HttpRequest({
    method: 'POST',
    protocol,
    hostname: baseUrl,
    path,
    headers: {
      host: baseUrl,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_names: [clientName]
    })
  })

  const signed = await signer.sign(requestToSign)

  const uri = `${protocol}://${baseUrl}${path}`

  logger.info(uri)

  // The response holds the new client secret, so it's never logged
  let response
  try {
    response = await Wreck.post(uri, {
      headers: signed.headers,
      json: true,
      payload: signed.body,
      timeout: rotateTimeoutMs
    })
  } catch (err) {
    // Wreck throws for 4xx/5xx responses as well as timeouts, network and
    // parse errors. Only a 4xx means CDP refused the rotation
    const statusCode = err.data?.isResponseError
      ? err.output?.statusCode
      : undefined
    const refused = statusCode >= 400 && statusCode < 500
    const message = `Failed to rotate Cognito credentials: ${err.message}`
    logger.error(message)
    throw new RotationError(message, { outcomeUnknown: !refused, cause: err })
  }

  const { statusCode } = response.res
  if (statusCode < 200 || statusCode >= 300) {
    const message = `Failed to rotate Cognito credentials. Status code: ${statusCode}`
    logger.error(message)
    throw new RotationError(message, { outcomeUnknown: false })
  }

  logger.info('Successfully rotated Cognito credentials')

  return toCognitoClients(response.payload)
}

async function deleteCognitoCredential(serviceName, clientName) {
  logger.info('Deleting Cognito credentials')

  const path = deleteClientsPath.replace(
    '{service_name}',
    encodeURIComponent(serviceName)
  )

  const requestToSign = new HttpRequest({
    method: 'POST',
    protocol,
    hostname: baseUrl,
    path,
    headers: {
      host: baseUrl,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_names: [clientName]
    })
  })

  const signed = await signer.sign(requestToSign)

  const uri = `${protocol}://${baseUrl}${path}`

  logger.info(uri)

  const { res, payload } = await Wreck.post(uri, {
    headers: signed.headers,
    json: true,
    payload: signed.body
  })

  // return from a deletion must be an empty array
  const clientDetailsIsEmptyArray =
    Array.isArray(payload['client_details']) &&
    payload['client_details'].length === 0

  if (
    res.statusCode < 200 ||
    res.statusCode >= 300 ||
    !clientDetailsIsEmptyArray
  ) {
    const message = `Failed to delete Cognito credentials. Status code: ${res.statusCode}`
    logger.error(message)
    throw new Error(message)
  }

  logger.info('Successfully deleted Cognito credentials')
}

export {
  allCognitoCredentials,
  createCognitoCredential,
  rotateCognitoCredential,
  deleteCognitoCredential,
  RotationError
}

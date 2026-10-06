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
  rotateClientsPath,
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

const signer = new SignatureV4({
  credentials: defaultProvider(),
  region,
  service: signerService,
  sha256: Sha256
})

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

  return payload
}

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

  return response.payload
}

export { allCognitoCredentials, rotateCognitoCredential, RotationError }

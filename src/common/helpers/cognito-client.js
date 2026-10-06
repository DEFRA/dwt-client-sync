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
  protocol
} = config.get('cognito')

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

  const path = rotateClientsPath.replace('{service-name}', serviceName)

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
  const { res, payload } = await Wreck.post(uri, {
    headers: signed.headers,
    json: true,
    payload: signed.body
  })

  if (res.statusCode !== 200) {
    logger.error(
      `Failed to rotate Cognito credentials. Status code: ${res.statusCode}`
    )
    throw new Error(
      `Failed to rotate Cognito credentials. Status code: ${res.statusCode}`
    )
  }

  logger.info('Successfully rotated Cognito credentials')

  return payload
}

export { allCognitoCredentials, rotateCognitoCredential }

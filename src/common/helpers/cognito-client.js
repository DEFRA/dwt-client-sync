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
      'content-type': 'application/json',
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

  return payload
}

export { allCognitoCredentials, createCognitoCredential }

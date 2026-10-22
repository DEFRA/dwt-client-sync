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
  purgeClientsPath,
  deleteClientsPath,
  rotateTimeoutMs,
  createTimeoutMs,
  purgeTimeoutMs,
  protocol
} = config.get('cognito')

/**
 * A failed create, rotate or purge request. `outcomeUnknown` is true when CDP may
 * still have made the change (timeout, network error, 5xx or unreadable
 * response), and false when CDP refused the request (4xx), so nothing changed.
 */
class CdpError extends Error {
  constructor(message, { outcomeUnknown, cause }) {
    super(message, { cause })
    this.name = 'CdpError'
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
 * @property {{ id: string, createdAt: string }[]} [secrets] - The client's
 * secrets, without their values. Only sent when listing clients
 */

/**
 * Maps the clients in a CDP credentials response (snake_case) to Cognito
 * clients, dropping anything else CDP sends.
 * @param {{ client_details?: object[] }} payload
 * @returns {CognitoClient[] | undefined} undefined when the response has no
 * client details, or any of them isn't an object, as it can't be read
 */
function toCognitoClients(payload) {
  const clientDetails = payload?.client_details

  if (
    !Array.isArray(clientDetails) ||
    !clientDetails.every((details) => details && typeof details === 'object')
  ) {
    return undefined
  }

  return clientDetails.map(
    ({
      client_id: clientId,
      client_name: clientName,
      client_secret: clientSecret,
      client_secrets: secrets
    }) => ({
      clientId,
      clientName,
      ...(clientSecret !== undefined && { clientSecret }),
      // The list returns each secret's id and creation date, never its value
      ...(Array.isArray(secrets) && {
        secrets: secrets
          .filter((secret) => secret && typeof secret === 'object')
          .map(({ id, created_at: createdAt }) => ({ id, createdAt }))
      })
    })
  )
}

/**
 * Sends a signed POST to CDP, throwing a CdpError that says whether CDP may
 * still have acted if the request fails. The response can hold client
 * secrets, so it's never logged.
 * @param {string} action - What the request does, for error messages
 * @param {string} uri
 * @param {{ headers: object, body: string }} signed - The signed request
 * @param {object} [options] - Extra Wreck options
 * @returns {Promise<object>} The response payload
 */
async function postToCdp(action, uri, signed, options = {}) {
  let response
  try {
    response = await Wreck.post(uri, {
      headers: signed.headers,
      json: true,
      payload: signed.body,
      ...options
    })
  } catch (err) {
    // Wreck throws for 4xx/5xx responses as well as timeouts, network and
    // parse errors. Only a 4xx means CDP refused the request
    const statusCode = err.data?.isResponseError
      ? err.output?.statusCode
      : undefined
    const refused = statusCode >= 400 && statusCode < 500
    const message = `Failed to ${action} Cognito credentials: ${err.message}`
    logger.error(message)
    throw new CdpError(message, { outcomeUnknown: !refused, cause: err })
  }

  const { statusCode } = response.res
  if (statusCode < 200 || statusCode >= 300) {
    const message = `Failed to ${action} Cognito credentials. Status code: ${statusCode}`
    logger.error(message)
    throw new CdpError(message, { outcomeUnknown: false })
  }

  return response.payload
}

const signer = new SignatureV4({
  credentials: defaultProvider(),
  region,
  service: signerService,
  sha256: Sha256
})

// CDP returns at most 60 clients a page. Its docs say to retry a throttled
// request (429) with a smaller page size, so each retry halves it. Retries are
// counted per page, with a cap for the whole listing
const maxPageSize = 60
const maxThrottledRetriesPerPage = 5
const maxThrottledRetries = 20
const throttledRetryDelayMs = 250

// A guard against pagination that never ends
const maxPages = 1000

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Wreck throws a Boom error for a 4xx or 5xx response, marked isResponseError
const isThrottled = (err) =>
  err.data?.isResponseError && err.output?.statusCode === 429

/**
 * Gets one page of the clients in a service's user pool.
 * @param {string} serviceName
 * @param {{ pageSize: number, nextToken: string | null }} page
 * @returns {Promise<object>} CDP's response
 */
async function fetchClientsPage(serviceName, { pageSize, nextToken }) {
  const path = listClientsPath.replace('{service-name}', serviceName)
  const query = {
    page_size: String(pageSize),
    ...(nextToken && { next_token: nextToken })
  }

  // The query string is part of the signature, so the URL must send the same
  // values that were signed
  const requestToSign = new HttpRequest({
    method: 'GET',
    protocol,
    hostname: baseUrl,
    path,
    query,
    headers: {
      host: baseUrl
    }
  })

  const signed = await signer.sign(requestToSign)

  const queryString = Object.entries(query)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')
  const uri = `${protocol}://${baseUrl}${path}?${queryString}`

  logger.info(`${protocol}://${baseUrl}${path} (page size ${pageSize})`)

  const { res, payload } = await Wreck.get(uri, {
    headers: signed.headers,
    json: true
  })

  if (res.statusCode !== 200) {
    throw new Error(
      `Failed to fetch Cognito credentials. Status code: ${res.statusCode}`
    )
  }

  return payload
}

/**
 * Gets one page, retrying with smaller pages while CDP throttles the request.
 * @param {string} serviceName
 * @param {{ pageSize: number, nextToken: string | null }} page
 * @param {number} retriesLeft - The retries left for the whole listing
 * @param {number} [attempt] - How many times this page has been retried
 * @returns {Promise<{ payload: object, pageSize: number, retriesLeft: number }>}
 * CDP's response, the page size that got it, and the retries still left
 */
async function fetchClientsPageWithRetries(
  serviceName,
  { pageSize, nextToken },
  retriesLeft,
  attempt = 0
) {
  try {
    const payload = await fetchClientsPage(serviceName, { pageSize, nextToken })
    return { payload, pageSize, retriesLeft }
  } catch (err) {
    const canRetry =
      isThrottled(err) &&
      attempt < maxThrottledRetriesPerPage &&
      retriesLeft > 0

    if (!canRetry) {
      logger.error(`Failed to fetch Cognito credentials: ${err.message}`)
      throw err
    }

    await wait(throttledRetryDelayMs * 2 ** attempt)

    const smallerPageSize = Math.max(1, Math.floor(pageSize / 2))
    logger.warn(
      `Cognito credentials request throttled, retrying with page size ${smallerPageSize}`
    )

    return fetchClientsPageWithRetries(
      serviceName,
      { pageSize: smallerPageSize, nextToken },
      retriesLeft - 1,
      attempt + 1
    )
  }
}

/**
 * Gets every client in a service's user pool, page by page.
 *
 * Sync treats a client missing from the list as deleted, so this guards
 * against returning part of the list: it throws if a page fails, and returns
 * undefined if a page can't be read or looks cut short.
 *
 * @param {string} serviceName
 * @returns {Promise<CognitoClient[] | undefined>}
 */
async function allCognitoCredentials(serviceName) {
  logger.info('Fetching all Cognito credentials')

  const clients = []
  const seenTokens = new Set()
  let retriesLeft = maxThrottledRetries
  let pageSize = maxPageSize
  let nextToken = null
  let pages = 0

  do {
    if (pages >= maxPages) {
      throw new Error(
        `Failed to fetch Cognito credentials: more than ${maxPages} pages`
      )
    }

    const result = await fetchClientsPageWithRetries(
      serviceName,
      { pageSize, nextToken },
      retriesLeft
    )
    const { payload, pageSize: pageSizeUsed } = result
    retriesLeft = result.retriesLeft

    const page = toCognitoClients(payload)
    if (!page) {
      return undefined
    }

    // CDP always sends next_token, so a full page without it may be only part
    // of the list. A shorter one is taken as the whole list, as CDP returned
    // before it paginated
    if (!('next_token' in payload) && page.length === pageSizeUsed) {
      logger.error('Cognito credentials page is full but has no next_token')
      return undefined
    }

    clients.push(...page)
    pages++

    // Back towards full pages once CDP stops throttling
    pageSize = Math.min(maxPageSize, pageSizeUsed * 2)
    nextToken = payload.next_token ?? null

    if (seenTokens.has(nextToken)) {
      throw new Error(
        'Failed to fetch Cognito credentials: CDP repeated a pagination token'
      )
    }
    if (nextToken) {
      seenTokens.add(nextToken)
    }
  } while (nextToken)

  logger.info(
    `Successfully fetched all ${clients.length} Cognito credentials in ${pages} page(s)`
  )
  return clients
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

  const payload = await postToCdp('create', uri, signed, {
    timeout: createTimeoutMs
  })

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

  const payload = await postToCdp('rotate', uri, signed, {
    timeout: rotateTimeoutMs
  })

  logger.info('Successfully rotated Cognito credentials')

  return toCognitoClients(payload)
}

/**
 * Removes a client's older secrets, keeping its newest. CDP purges by name,
 * so it acts on every client with that name.
 * @param {string} serviceName
 * @param {string} clientName
 * @param {string} creationCutoff - Only secrets created before this ISO 8601
 * date-time are removed
 * @returns {Promise<CognitoClient[] | undefined>} Every client purged, without secrets
 */
async function purgeCognitoCredential(serviceName, clientName, creationCutoff) {
  logger.info('Purging old Cognito credentials')

  const path = purgeClientsPath.replace(
    '{service-name}',
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
      client_names: [clientName],
      creation_cutoff: creationCutoff
    })
  })

  const signed = await signer.sign(requestToSign)

  const uri = `${protocol}://${baseUrl}${path}`

  logger.info(uri)

  const payload = await postToCdp('purge', uri, signed, {
    timeout: purgeTimeoutMs
  })

  logger.info('Successfully purged old Cognito credentials')

  return toCognitoClients(payload)
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

  // A deletion returns no clients
  const remainingClients = toCognitoClients(payload)

  if (
    res.statusCode < 200 ||
    res.statusCode >= 300 ||
    remainingClients?.length !== 0
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
  purgeCognitoCredential,
  deleteCognitoCredential,
  CdpError
}

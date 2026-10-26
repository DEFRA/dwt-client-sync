import { describe, it, expect, vi, beforeEach } from 'vitest'
import Boom from '@hapi/boom'

const { mockGet, mockSign, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSign: vi.fn(),
  mockPost: vi.fn()
}))

vi.mock('@aws-sdk/signature-v4', () => ({
  SignatureV4: vi.fn(function () {
    this.sign = mockSign
  })
}))

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn(() => vi.fn())
}))

vi.mock('@hapi/wreck', () => ({
  default: {
    get: mockGet,
    post: mockPost
  }
}))

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn(() => ({
      baseUrl: 'example.com',
      region: 'eu-west-2',
      signerService: 'execute-api',
      listClientsPath: '/clients/{service-name}',
      createClientsPath: '/create-clients/{service-name}',
      deleteClientsPath: '/delete-clients/{service_name}',
      rotateClientsPath: '/rotate-clients/{service-name}',
      purgeClientsPath: '/purge-clients/{service-name}',
      protocol: 'https'
    }))
  }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

const {
  allCognitoCredentials,
  createCognitoCredential,
  rotateCognitoCredential,
  purgeCognitoCredential,
  deleteCognitoCredential,
  CdpError
} = await import('./cognito-client.js')

// The logger the module created when it was imported
const { createLogger } = await import('#/common/helpers/logging/logger.js')
const logger = createLogger.mock.results[0].value

describe('allCognitoCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSign.mockResolvedValue({
      headers: {
        Authorization: 'mocked-signature',
        'X-Amz-Date': '20260918T150000Z'
      }
    })
  })

  it('returns Cognito credentials successfully', async () => {
    mockGet.mockResolvedValue({
      res: {
        statusCode: 200
      },
      payload: {
        cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
        tenant_service_name: 'my-service',
        client_details: [{ client_name: 'my_client', client_id: 'client-123' }]
      }
    })

    const result = await allCognitoCredentials('my-service')

    expect(result).toStrictEqual([
      { clientName: 'my_client', clientId: 'client-123' }
    ])
    expect(mockSign).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledTimes(1)
    const [url, options] = mockGet.mock.calls[0]
    expect(url).toBe('https://example.com/clients/my-service?page_size=60')
    expect(options.json).toBe(true)
  })

  // A page of CDP's response: the clients, and the token for the next page
  const page = (names, nextToken = null) => ({
    res: { statusCode: 200 },
    payload: {
      client_details: names.map((name) => ({
        client_name: name,
        client_id: `${name}-id`
      })),
      next_token: nextToken
    }
  })

  const throttled = () =>
    new Boom.Boom('Response Error: 429', {
      statusCode: 429,
      data: { isResponseError: true }
    })

  it('reads every page, following the token, and signs each query', async () => {
    mockGet
      .mockResolvedValueOnce(page(['a', 'b'], 'token+/=1'))
      .mockResolvedValueOnce(page(['c'], 'token2'))
      .mockResolvedValueOnce(page(['d']))

    const result = await allCognitoCredentials('my-service')

    expect(result.map(({ clientName }) => clientName)).toEqual([
      'a',
      'b',
      'c',
      'd'
    ])
    expect(mockGet.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/clients/my-service?page_size=60',
      'https://example.com/clients/my-service?page_size=60&next_token=token%2B%2F%3D1',
      'https://example.com/clients/my-service?page_size=60&next_token=token2'
    ])
    expect(mockSign.mock.calls.map(([request]) => request.query)).toEqual([
      { page_size: '60' },
      { page_size: '60', next_token: 'token+/=1' },
      { page_size: '60', next_token: 'token2' }
    ])
    expect(mockGet.mock.calls.map(([, options]) => options.timeout)).toEqual([
      120_000, 120_000, 120_000
    ])
  })

  it('returns undefined rather than part of the list when a later page cannot be read', async () => {
    mockGet
      .mockResolvedValueOnce(page(['a'], 'token1'))
      .mockResolvedValueOnce({ res: { statusCode: 200 }, payload: {} })

    expect(await allCognitoCredentials('my-service')).toBeUndefined()
  })

  it('throws rather than returning part of the list when a later page fails', async () => {
    mockGet
      .mockResolvedValueOnce(page(['a'], 'token1'))
      .mockRejectedValueOnce(new Error('socket hang up'))

    await expect(allCognitoCredentials('my-service')).rejects.toThrow(
      'socket hang up'
    )
  })

  describe('when CDP throttles a request', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('retries the same page with half the page size', async () => {
      mockGet
        .mockResolvedValueOnce(page(['a'], 'token1'))
        .mockRejectedValueOnce(throttled())
        .mockResolvedValueOnce(page(['b']))

      const result = allCognitoCredentials('my-service')
      await vi.runAllTimersAsync()

      expect((await result).map(({ clientName }) => clientName)).toEqual([
        'a',
        'b'
      ])
      expect(mockGet.mock.calls[2][0]).toBe(
        'https://example.com/clients/my-service?page_size=30&next_token=token1'
      )
    })

    it('waits 250ms before the first retry, then twice as long each time', async () => {
      mockGet
        .mockRejectedValueOnce(throttled())
        .mockRejectedValueOnce(throttled())
        .mockResolvedValueOnce(page(['a']))

      const result = allCognitoCredentials('my-service')

      await vi.advanceTimersByTimeAsync(249)
      expect(mockGet).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(mockGet).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(499)
      expect(mockGet).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(mockGet).toHaveBeenCalledTimes(3)
      await result
    })

    it('goes back to bigger pages after a page succeeds', async () => {
      mockGet
        .mockRejectedValueOnce(throttled())
        .mockResolvedValueOnce(page(['a'], 'token1'))
        .mockResolvedValueOnce(page(['b'], 'token2'))
        .mockResolvedValueOnce(page(['c']))

      const result = allCognitoCredentials('my-service')
      await vi.runAllTimersAsync()
      await result

      expect(
        mockGet.mock.calls.map(([url]) => url.match(/page_size=(\d+)/)[1])
      ).toEqual(['60', '30', '60', '60'])
    })

    it('counts retries for each page, so throttling spread over pages still succeeds', async () => {
      // Two 429s before each of four pages: eight in all
      for (const [names, token] of [
        [['a'], 't1'],
        [['b'], 't2'],
        [['c'], 't3'],
        [['d'], null]
      ]) {
        mockGet
          .mockRejectedValueOnce(throttled())
          .mockRejectedValueOnce(throttled())
          .mockResolvedValueOnce(page(names, token))
      }

      const result = allCognitoCredentials('my-service')
      await vi.runAllTimersAsync()

      expect((await result).map(({ clientName }) => clientName)).toEqual([
        'a',
        'b',
        'c',
        'd'
      ])
    })

    it('gives up after 20 retries across the whole list', async () => {
      let pageNumber = 0
      mockGet.mockImplementation(async () => {
        pageNumber++
        if (pageNumber % 2 === 1) {
          throw throttled()
        }
        return page(['a'], `token-${pageNumber}`)
      })

      const result = allCognitoCredentials('my-service').catch((err) => err)
      await vi.runAllTimersAsync()

      expect((await result).message).toBe('Response Error: 429')
      expect(mockGet).toHaveBeenCalledTimes(41)
    })

    it('gives up after five retries', async () => {
      mockGet.mockRejectedValue(throttled())

      const result = allCognitoCredentials('my-service').catch((err) => err)
      await vi.runAllTimersAsync()

      expect((await result).message).toBe('Response Error: 429')
      expect(mockGet).toHaveBeenCalledTimes(6)
    })
  })

  it('gives up if the pages never run out', async () => {
    let pageNumber = 0
    mockGet.mockImplementation(async () => page(['a'], `token-${++pageNumber}`))

    await expect(allCognitoCredentials('my-service')).rejects.toThrow(
      'Failed to fetch Cognito credentials: more than 1000 pages'
    )
    expect(mockGet).toHaveBeenCalledTimes(1000)
  })

  it('gives up as soon as CDP repeats a token', async () => {
    mockGet.mockResolvedValue(page(['a'], 'same-token'))

    await expect(allCognitoCredentials('my-service')).rejects.toThrow(
      'Failed to fetch Cognito credentials: CDP repeated a pagination token'
    )
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('returns undefined for a full page without a next_token field, which may be part of the list', async () => {
    const fullPage = page(Array.from({ length: 60 }, (_, i) => `client${i}`))
    delete fullPage.payload.next_token
    mockGet.mockResolvedValue(fullPage)

    expect(await allCognitoCredentials('my-service')).toBeUndefined()
  })

  it('accepts a shorter page without a next_token field as the whole list, as before pagination', async () => {
    const shortPage = page(['a', 'b'])
    delete shortPage.payload.next_token
    mockGet.mockResolvedValue(shortPage)

    expect(await allCognitoCredentials('my-service')).toHaveLength(2)
  })

  it('returns undefined when a later page has a client that is not an object', async () => {
    mockGet.mockResolvedValueOnce(page(['a'], 'token1')).mockResolvedValueOnce({
      res: { statusCode: 200 },
      payload: { client_details: [null], next_token: null }
    })

    expect(await allCognitoCredentials('my-service')).toBeUndefined()
  })

  it.each([
    ['refuses the request', 403],
    ['has a server error', 500]
  ])('does not retry when CDP %s', async (_, statusCode) => {
    mockGet.mockRejectedValue(
      new Boom.Boom(`Response Error: ${statusCode}`, {
        statusCode,
        data: { isResponseError: true }
      })
    )

    await expect(allCognitoCredentials('my-service')).rejects.toThrow(
      `Response Error: ${statusCode}`
    )
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it("maps each client's secrets, without their values", async () => {
    mockGet.mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        client_details: [
          {
            client_name: 'my_client',
            client_id: 'client-123',
            client_secret: null,
            client_secrets: [
              {
                id: 'client-123--1792131907342',
                created_at: '2026-10-16T06:25:07.342000+00:00'
              },
              null
            ]
          }
        ],
        next_token: null
      }
    })

    expect(await allCognitoCredentials('my-service')).toStrictEqual([
      {
        clientName: 'my_client',
        clientId: 'client-123',
        clientSecret: null,
        secrets: [
          {
            id: 'client-123--1792131907342',
            createdAt: '2026-10-16T06:25:07.342000+00:00'
          }
        ]
      }
    ])
  })

  it.each([
    ['no client details', { request_id: 'my_request_id' }],
    ['client details that are not a list', { client_details: {} }],
    [
      'a client that is not an object',
      { client_details: [null, { client_name: 'a', client_id: 'b' }] }
    ],
    ['no payload', null]
  ])('returns undefined when the response has %s', async (_, payload) => {
    mockGet.mockResolvedValue({
      res: { statusCode: 200 },
      payload
    })

    expect(await allCognitoCredentials('my-service')).toBeUndefined()
  })

  it('throws an error when the backend returns a non-200 status', async () => {
    mockGet.mockResolvedValue({
      res: {
        statusCode: 500
      },
      payload: {}
    })

    await expect(allCognitoCredentials('my-service')).rejects.toThrow(
      'Failed to fetch Cognito credentials. Status code: 500'
    )
    expect(mockSign).toHaveBeenCalledTimes(1)
  })
})

describe('createCognitoCredential', () => {
  it('returns created credentials successfully', async () => {
    mockPost.mockResolvedValue({
      res: {
        statusCode: 200
      },
      payload: {
        client_details: [
          {
            client_name: 'new-client',
            client_id: 'client-456',
            client_secret: 'secret'
          }
        ]
      }
    })

    const result = await createCognitoCredential('my-service', 'new-client')

    expect(result).toStrictEqual([
      {
        clientName: 'new-client',
        clientId: 'client-456',
        clientSecret: 'secret'
      }
    ])
    expect(mockSign).toHaveBeenCalledTimes(1)
    const [actualBodyToSign] = mockSign.mock.calls[0]
    expect(actualBodyToSign.headers).toStrictEqual({
      'content-type': 'application/json',
      host: 'example.com'
    })
    expect(actualBodyToSign.body).toBe('{"client_names":["new-client"]}')
    expect(mockPost).toHaveBeenCalledTimes(1)
    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/create-clients/my-service')
    expect(options.json).toBe(true)
  })

  it('throws an error when the backend returns a non-200 status', async () => {
    mockPost.mockResolvedValue({
      res: {
        statusCode: 500
      },
      payload: {}
    })

    await expect(
      createCognitoCredential('my-service', 'new-client')
    ).rejects.toThrow('Failed to create Cognito credentials. Status code: 500')
    expect(mockSign).toHaveBeenCalledTimes(1)
  })

  it('sets a timeout', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: { client_details: [] }
    })

    await createCognitoCredential('my-service', 'new-client')

    const options = mockPost.mock.calls[0][1]
    expect(options.timeout).toBe(120_000)
  })

  it.each([
    ['refuses the request', 403, false],
    ['returns a server error', 503, true]
  ])(
    'says whether CDP may have created the client when it %s',
    async (_, statusCode, outcomeUnknown) => {
      mockPost.mockRejectedValue(
        new Boom.Boom(`Response Error: ${statusCode}`, {
          statusCode,
          data: { isResponseError: true }
        })
      )

      const error = await createCognitoCredential(
        'my-service',
        'new-client'
      ).catch((err) => err)

      expect(error).toBeInstanceOf(CdpError)
      expect(error.outcomeUnknown).toBe(outcomeUnknown)
      expect(error.message).toBe(
        `Failed to create Cognito credentials: Response Error: ${statusCode}`
      )
    }
  )
})

describe('rotateCognitoCredential', () => {
  // What rotateCognitoCredential returns for rotatedCredentials
  const rotatedClients = [
    {
      clientName: 'my_client',
      clientId: 'client-789',
      clientSecret: 'new-secret'
    }
  ]
  const rotatedCredentials = {
    cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
    request_id: 'my_request_id',
    tenant_service_name: 'my-service',
    client_details: [
      {
        client_name: 'my_client',
        client_id: 'client-789',
        client_secret: 'new-secret'
      }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockSign.mockImplementation(async (request) => ({
      headers: { ...request.headers, Authorization: 'mocked-signature' },
      body: request.body
    }))
  })

  it('returns rotated credentials successfully', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: rotatedCredentials
    })

    const result = await rotateCognitoCredential('my-service', 'my_client')

    expect(result).toStrictEqual(rotatedClients)
    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/rotate-clients/my-service')
    expect(options.json).toBe(true)
  })

  it('signs the JSON body that it sends', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: rotatedCredentials
    })

    await rotateCognitoCredential('my-service', 'my_client')

    const [requestToSign] = mockSign.mock.calls[0]
    expect(requestToSign.method).toBe('POST')
    expect(requestToSign.headers['content-type']).toBe('application/json')
    expect(requestToSign.body).toBe(
      JSON.stringify({ client_names: ['my_client'] })
    )
    const options = mockPost.mock.calls[0][1]
    expect(options.payload).toBe(requestToSign.body)
  })

  it('sets a timeout and encodes the service name in the path', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: rotatedCredentials
    })

    await rotateCognitoCredential('my service', 'my_client')

    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/rotate-clients/my%20service')
    expect(options.timeout).toBe(120_000)
  })

  it('accepts any 2xx response', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 201 },
      payload: rotatedCredentials
    })

    await expect(
      rotateCognitoCredential('my-service', 'my_client')
    ).resolves.toStrictEqual(rotatedClients)
  })

  // Wreck's shortcut methods throw a Boom error for 4xx/5xx responses
  const responseError = (statusCode) =>
    new Boom.Boom(`Response Error: ${statusCode}`, {
      statusCode,
      data: { isResponseError: true }
    })

  it('reports a known failure when CDP refuses the request', async () => {
    mockPost.mockRejectedValue(responseError(403))

    const error = await rotateCognitoCredential(
      'my-service',
      'my_client'
    ).catch((err) => err)

    expect(error).toBeInstanceOf(CdpError)
    expect(error.outcomeUnknown).toBe(false)
    expect(error.message).toBe(
      'Failed to rotate Cognito credentials: Response Error: 403'
    )
  })

  it.each([
    ['CDP returns a server error', responseError(503)],
    ['the request times out', Boom.gatewayTimeout('Client request timeout')],
    ['the connection fails', new Error('socket hang up')]
  ])('reports an unknown outcome when %s', async (_, err) => {
    mockPost.mockRejectedValue(err)

    const error = await rotateCognitoCredential(
      'my-service',
      'my_client'
    ).catch((e) => e)

    expect(error).toBeInstanceOf(CdpError)
    expect(error.outcomeUnknown).toBe(true)
  })

  it('reports a known failure for a non-2xx response below 400', async () => {
    mockPost.mockResolvedValue({ res: { statusCode: 302 }, payload: null })

    const error = await rotateCognitoCredential(
      'my-service',
      'my_client'
    ).catch((err) => err)

    expect(error).toBeInstanceOf(CdpError)
    expect(error.outcomeUnknown).toBe(false)
    // An empty response leaves nothing to describe
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to rotate Cognito credentials. Status code: 302'
    )
  })
})

describe('purgeCognitoCredential', () => {
  const cutoff = '2026-10-16T06:25:07.342000+00:00'
  const purgedCredentials = {
    cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
    request_id: 'my_request_id',
    tenant_service_name: 'my-service',
    client_details: [
      { client_name: 'my_client', client_id: 'client-789', client_secret: null }
    ]
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockSign.mockImplementation(async (request) => ({
      headers: { ...request.headers, Authorization: 'mocked-signature' },
      body: request.body
    }))
  })

  it('returns the purged clients', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: purgedCredentials
    })

    const result = await purgeCognitoCredential(
      'my-service',
      'my_client',
      cutoff
    )

    expect(result).toStrictEqual([
      { clientName: 'my_client', clientId: 'client-789', clientSecret: null }
    ])
    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/purge-clients/my-service')
    expect(options.json).toBe(true)
  })

  it('signs the JSON body, with the cutoff, that it sends', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: purgedCredentials
    })

    await purgeCognitoCredential('my-service', 'my_client', cutoff)

    const [requestToSign] = mockSign.mock.calls[0]
    expect(requestToSign.method).toBe('POST')
    expect(requestToSign.headers['content-type']).toBe('application/json')
    expect(requestToSign.body).toBe(
      JSON.stringify({ client_names: ['my_client'], creation_cutoff: cutoff })
    )
    const options = mockPost.mock.calls[0][1]
    expect(options.payload).toBe(requestToSign.body)
  })

  it('sets a timeout and encodes the service name in the path', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: purgedCredentials
    })

    await purgeCognitoCredential('my service', 'my_client', cutoff)

    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/purge-clients/my%20service')
    expect(options.timeout).toBe(120_000)
  })

  it('reports a known failure when CDP refuses the request', async () => {
    mockPost.mockRejectedValue(
      new Boom.Boom('Response Error: 400', {
        statusCode: 400,
        data: { isResponseError: true }
      })
    )

    const error = await purgeCognitoCredential(
      'my-service',
      'my_client',
      cutoff
    ).catch((err) => err)

    expect(error).toBeInstanceOf(CdpError)
    expect(error.outcomeUnknown).toBe(false)
    expect(error.message).toBe(
      'Failed to purge Cognito credentials: Response Error: 400'
    )
  })

  it("logs CDP's request ID and reason when it refuses the request", async () => {
    mockPost.mockRejectedValue(
      new Boom.Boom('Response Error: 400 Bad Request', {
        statusCode: 400,
        data: {
          isResponseError: true,
          headers: { 'x-amzn-requestid': 'my-request-id' },
          payload: { message: 'Invalid request body' }
        }
      })
    )

    await purgeCognitoCredential('my-service', 'my_client', cutoff).catch(
      () => {}
    )

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to purge Cognito credentials: Response Error: 400 Bad Request (request ID my-request-id, response: {"message":"Invalid request body"})'
    )
  })

  it("logs only the start of a long response, and a body that isn't JSON", async () => {
    mockPost.mockRejectedValue(
      new Boom.Boom('Response Error: 500', {
        statusCode: 500,
        data: {
          isResponseError: true,
          headers: {},
          payload: Buffer.from('x'.repeat(600))
        }
      })
    )

    await purgeCognitoCredential('my-service', 'my_client', cutoff).catch(
      () => {}
    )

    expect(logger.error).toHaveBeenCalledWith(
      `Failed to purge Cognito credentials: Response Error: 500 (response: ${'x'.repeat(500)})`
    )
  })

  it('reports an unknown outcome when the request times out', async () => {
    mockPost.mockRejectedValue(Boom.gatewayTimeout('Client request timeout'))

    const error = await purgeCognitoCredential(
      'my-service',
      'my_client',
      cutoff
    ).catch((err) => err)

    expect(error).toBeInstanceOf(CdpError)
    expect(error.outcomeUnknown).toBe(true)
    // There's no response to describe
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to purge Cognito credentials: Client request timeout'
    )
  })
})

describe('deleteCognitoCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSign.mockImplementation(async (request) => ({
      headers: { ...request.headers, Authorization: 'mocked-signature' },
      body: request.body
    }))
  })

  it('returns deleted credentials successfully', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
        request_id: 'my-request-id',
        tenant_service_name: encodeURIComponent('my-service'),
        client_details: []
      }
    })

    const result = await deleteCognitoCredential('my-service', 'my_client')

    expect(result).toEqual(undefined)
    expect(mockSign).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledTimes(1)

    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/delete-clients/my-service')
    expect(options.json).toBe(true)
  })

  it('signs the JSON body that it sends', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
        request_id: 'my-request-id',
        tenant_service_name: encodeURIComponent('my-service'),
        client_details: []
      }
    })

    await deleteCognitoCredential('my-service', 'my_client')

    const [requestToSign] = mockSign.mock.calls[0]
    expect(requestToSign.method).toBe('POST')
    expect(requestToSign.headers['content-type']).toBe('application/json')
    expect(requestToSign.body).toBe(
      JSON.stringify({ client_names: ['my_client'] })
    )
    const options = mockPost.mock.calls[0][1]
    expect(options.payload).toBe(requestToSign.body)
  })

  it('sets a timeout and encodes the service name in the path', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 200 },
      payload: {
        cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
        request_id: 'my-request-id',
        tenant_service_name: encodeURIComponent('my service'),
        client_details: []
      }
    })

    await deleteCognitoCredential('my service', 'my_client')

    const [url, options] = mockPost.mock.calls[0]
    expect(url).toBe('https://example.com/delete-clients/my%20service')
    expect(options.timeout).toBe(120_000)
  })

  it('throws an error when the backend returns a non-200 status', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 500 },
      payload: {}
    })

    await expect(
      deleteCognitoCredential('my-service', 'my_client')
    ).rejects.toThrow('Failed to delete Cognito credentials. Status code: 500')
    expect(mockSign).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      message: 'boo!'
    },
    {
      clientDetails: ['Not empty']
    },
    {
      client_details: [{ client_name: 'my_client', client_id: 'client-1' }]
    },
    null
  ])(
    'throws an error if the backend succeeds but returns %o',
    async (payload) => {
      mockPost.mockResolvedValue({
        res: { statusCode: 200 },
        payload
      })

      await expect(
        deleteCognitoCredential('my-service', 'my_client')
      ).rejects.toThrow(
        'Failed to delete Cognito credentials. Status code: 200'
      )
      expect(mockSign).toHaveBeenCalledTimes(1)
    }
  )
})

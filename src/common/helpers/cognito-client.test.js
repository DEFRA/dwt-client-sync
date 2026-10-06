import { describe, it, expect, vi, beforeEach } from 'vitest'

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
      rotateClientsPath: '/rotate-clients/{service-name}',
      protocol: 'https'
    }))
  }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn()
  }))
}))

const { allCognitoCredentials, rotateCognitoCredential } =
  await import('./cognito-client.js')

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
    const expectedResult = [
      {
        clientId: 'client-123',
        clientSecret: 'secret'
      }
    ]

    mockGet.mockResolvedValue({
      res: {
        statusCode: 200
      },
      payload: expectedResult
    })

    const result = await allCognitoCredentials('my-service')

    expect(result).toEqual(expectedResult)
    expect(mockSign).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledTimes(1)
    const [url, options] = mockGet.mock.calls[0]
    expect(url).toBe('https://example.com/clients/my-service')
    expect(options.json).toBe(true)
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

describe('rotateCognitoCredential', () => {
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

    expect(result).toEqual(rotatedCredentials)
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
    const [, options] = mockPost.mock.calls[0]
    expect(options.payload).toBe(requestToSign.body)
  })

  it('throws an error when the backend returns a non-200 status', async () => {
    mockPost.mockResolvedValue({
      res: { statusCode: 500 },
      payload: {}
    })

    await expect(
      rotateCognitoCredential('my-service', 'my_client')
    ).rejects.toThrow('Failed to rotate Cognito credentials. Status code: 500')
  })
})

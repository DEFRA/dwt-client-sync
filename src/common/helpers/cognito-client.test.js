import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGet = vi.fn()

vi.mock('@hapi/wreck', () => ({
  default: {
    get: mockGet
  }
}))

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn(() => ({
      baseUrl: 'example.com',
      region: 'eu-west-2',
      signerService: 'execute-api',
      listClientsPath: '/clients/{service-name}',
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

const { allCognitoCredentials } = await import('./cognito-client.js')

describe('allCognitoCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
  })
})

import { vi, describe, it, expect, beforeEach } from 'vitest'
import Wreck from '@hapi/wreck'

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'cognito') {
        return {
          baseUrl: 'mockserver:1080',
          region: 'eu-west-1',
          signerService: 'execute-api',
          listClientsPath:
            '/tenants/services/{service-name}/user-pool/fetch-details',
          protocol: 'http'
        }
      }
      return undefined
    })
  }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: vi.fn()
}))

const mockSign = vi.fn().mockResolvedValue({
  headers: { authorization: 'AWS4-HMAC-SHA256 mock-signature' }
})

vi.mock('@aws-sdk/signature-v4', () => ({
  SignatureV4: vi.fn().mockImplementation(() => ({
    sign: mockSign
  }))
}))

vi.mock('@hapi/wreck', () => ({
  default: {
    get: vi.fn()
  }
}))

describe('allCognitoCredentials', () => {
  let allCognitoCredentials

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSign.mockResolvedValue({
      headers: { authorization: 'AWS4-HMAC-SHA256 mock-signature' }
    })
    ;({ allCognitoCredentials } =
      await import('#/common/helpers/cognito-client.js'))
  })

  it('fetches and returns credentials on a 200 response', async () => {
    const responsePayload = {
      client_details: [
        { client_name: 'Client One', client_id: 'client-1' },
        { client_name: 'Client Two', client_id: 'client-2' }
      ]
    }

    Wreck.get.mockResolvedValue({
      res: { statusCode: 200 },
      payload: responsePayload
    })

    const result = await allCognitoCredentials('waste-movement-external-api')

    expect(result).toEqual(responsePayload)
  })

  it('builds the request URL with the service name interpolated into the path', async () => {
    Wreck.get.mockResolvedValue({
      res: { statusCode: 200 },
      payload: { client_details: [] }
    })

    await allCognitoCredentials('waste-movement-external-api')

    expect(Wreck.get).toHaveBeenCalledWith(
      'http://mockserver:1080/tenants/services/waste-movement-external-api/user-pool/fetch-details',
      expect.objectContaining({ json: true })
    )
  })

  it('signs the request and forwards the signed headers to Wreck', async () => {
    Wreck.get.mockResolvedValue({
      res: { statusCode: 200 },
      payload: { client_details: [] }
    })

    await allCognitoCredentials('waste-movement-external-api')

    expect(mockSign).toHaveBeenCalled()
    expect(Wreck.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { authorization: 'AWS4-HMAC-SHA256 mock-signature' }
      })
    )
  })

  it('throws and logs when the response status code is not 200', async () => {
    Wreck.get.mockResolvedValue({
      res: { statusCode: 403 },
      payload: { message: 'Forbidden' }
    })

    await expect(
      allCognitoCredentials('waste-movement-external-api')
    ).rejects.toThrow('Failed to fetch Cognito credentials. Status code: 403')
  })

  it('propagates a network-level error thrown by Wreck', async () => {
    Wreck.get.mockRejectedValue(
      new Error('Client request error: getaddrinfo ENOTFOUND')
    )

    await expect(
      allCognitoCredentials('waste-movement-external-api')
    ).rejects.toThrow('Client request error: getaddrinfo ENOTFOUND')
  })
})

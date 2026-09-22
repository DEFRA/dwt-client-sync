import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAllCognitoCredentials } = vi.hoisted(() => ({
  mockAllCognitoCredentials: vi.fn()
}))

vi.mock('#/common/helpers/cognito-client.js', () => ({
  allCognitoCredentials: mockAllCognitoCredentials
}))

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn(() => ({
      serviceSyncList: 'service-one, service-two'
    }))
  }
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn()
  }))
}))

const { sync } = await import('./client-sync.js')

describe('Software Provider sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all synced clients', async () => {
    mockAllCognitoCredentials.mockResolvedValue({
      client_details: [
        { client_name: 'Client One', client_id: 'client-1' },
        { client_name: 'Client Two', client_id: 'client-2' }
      ]
    })

    const result = await sync()

    expect(result).toEqual({
      totalServicesProcessed: 2,
      services: [
        {
          serviceName: 'service-one',
          credentialsSynced: 2
        },
        {
          serviceName: 'service-two',
          credentialsSynced: 2
        }
      ]
    })

    expect(mockAllCognitoCredentials).toHaveBeenCalledTimes(2)

    expect(mockAllCognitoCredentials).toHaveBeenNthCalledWith(1, 'service-one')

    expect(mockAllCognitoCredentials).toHaveBeenNthCalledWith(2, 'service-two')
  })

  it('returns empty result when no services are configured', async () => {
    vi.resetModules()

    vi.doMock('#/config.js', () => ({
      config: {
        get: vi.fn(() => ({
          serviceSyncList: ''
        }))
      }
    }))

    const { sync } = await import('./client-sync.js')

    const result = await sync()

    expect(result).toEqual({
      totalServicesProcessed: 0,
      services: []
    })

    expect(mockAllCognitoCredentials).not.toHaveBeenCalled()
  })

  it('handles missing credentials', async () => {
    mockAllCognitoCredentials.mockResolvedValue({
      body: {}
    })

    const result = await sync()

    expect(result).toEqual({
      totalServicesProcessed: 2,
      services: [
        {
          serviceName: 'service-one',
          credentialsSynced: 0
        },
        {
          serviceName: 'service-two',
          credentialsSynced: 0
        }
      ]
    })
  })

  it('handles errors fetching credentials', async () => {
    mockAllCognitoCredentials.mockRejectedValue(new Error('Backend error'))

    const result = await sync()

    expect(result).toEqual({
      totalServicesProcessed: 0,
      services: []
    })
  })

  it('trims service names and ignores empty values', async () => {
    const { config } = await import('#/config.js')

    config.get.mockReturnValueOnce({
      serviceSyncList: ' service-one, , service-two '
    })

    mockAllCognitoCredentials.mockResolvedValue({
      body: {
        client_details: []
      }
    })

    const result = await sync()

    expect(result.totalServicesProcessed).toBe(2)

    expect(mockAllCognitoCredentials).toHaveBeenNthCalledWith(1, 'service-one')

    expect(mockAllCognitoCredentials).toHaveBeenNthCalledWith(2, 'service-two')
  })
})

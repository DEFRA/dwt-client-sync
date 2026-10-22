import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockAcquireLock,
  mockReleaseLock,
  mockAllCognitoCredentials,
  mockStore,
  mockReadStoredClients
} = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockAllCognitoCredentials: vi.fn(),
  mockStore: vi.fn(),
  mockReadStoredClients: vi.fn()
}))

vi.mock('#/common/helpers/cognito-client.js', () => ({
  allCognitoCredentials: mockAllCognitoCredentials
}))

vi.mock('#/services/clients.js', () => ({
  store: mockStore,
  readStoredClients: mockReadStoredClients
}))

vi.mock('#/common/helpers/mongo-lock.js', () => ({
  acquireLock: mockAcquireLock,
  releaseLock: mockReleaseLock
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
  beforeAll(() => {
    const mockLock = {
      release: vi.fn()
    }
    mockAcquireLock.mockResolvedValue(mockLock)
    mockReleaseLock.mockResolvedValue(mockLock)
  })

  const storedClients = [{ clientId: 'client-1', clientName: 'Client One' }]

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadStoredClients.mockResolvedValue(storedClients)
  })

  // If sync listed first, a client created after the list and saved before
  // the read would look deleted from CDP
  it('reads the stored clients before listing CDP, and stores against them', async () => {
    mockAllCognitoCredentials.mockResolvedValue([])
    const db = {}

    await sync(db)

    const [readOrder] = mockReadStoredClients.mock.invocationCallOrder
    const [listOrder] = mockAllCognitoCredentials.mock.invocationCallOrder
    expect(readOrder).toBeLessThan(listOrder)
    expect(mockReadStoredClients).toHaveBeenCalledWith(
      expect.anything(),
      db,
      'service-one'
    )
    expect(mockStore).toHaveBeenCalledWith(
      expect.anything(),
      db,
      [],
      'service-one',
      storedClients
    )
  })

  it('returns all synced clients', async () => {
    mockAllCognitoCredentials.mockResolvedValue([
      { clientName: 'Client One', clientId: 'client-1' },
      { clientName: 'Client Two', clientId: 'client-2' }
    ])

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

    expect(mockStore).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      undefined,
      [
        {
          clientId: 'client-1',
          clientName: 'Client One',
          tenantServiceName: 'service-one'
        },
        {
          clientId: 'client-2',
          clientName: 'Client Two',
          tenantServiceName: 'service-one'
        }
      ],
      'service-one',
      storedClients
    )
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
    mockAllCognitoCredentials.mockResolvedValue(undefined)

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

    // Missing details must never be taken as "no clients", which deletes them all
    expect(mockStore).not.toHaveBeenCalled()
  })

  it('removes every stored client when Cognito returns no clients', async () => {
    mockAllCognitoCredentials.mockResolvedValue([])
    const db = {}

    await sync(db)

    expect(mockStore).toHaveBeenCalledWith(
      expect.anything(),
      db,
      [],
      'service-one',
      storedClients
    )
    expect(mockStore).toHaveBeenCalledWith(
      expect.anything(),
      db,
      [],
      'service-two',
      storedClients
    )
  })

  it('handles errors fetching credentials', async () => {
    mockAllCognitoCredentials.mockRejectedValue(new Error('Backend error'))

    await expect(sync()).rejects.toThrow('Backend error')
  })

  it('trims service names and ignores empty values', async () => {
    const { config } = await import('#/config.js')

    config.get.mockReturnValueOnce({
      serviceSyncList: ' service-one, , service-two '
    })

    mockAllCognitoCredentials.mockResolvedValue([])

    const result = await sync()

    expect(result.totalServicesProcessed).toBe(2)

    expect(mockAllCognitoCredentials).toHaveBeenNthCalledWith(1, 'service-one')

    expect(mockAllCognitoCredentials).toHaveBeenNthCalledWith(2, 'service-two')
  })
})

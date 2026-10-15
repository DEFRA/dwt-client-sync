const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn()
}

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const { MockRotationError } = vi.hoisted(() => ({
  MockRotationError: class extends Error {
    constructor(message, { outcomeUnknown }) {
      super(message)
      this.outcomeUnknown = outcomeUnknown
    }
  }
}))

vi.mock('#/common/helpers/cognito-client.js', () => ({
  allCognitoCredentials: vi.fn().mockResolvedValue([]),
  createCognitoCredential: vi.fn(),
  rotateCognitoCredential: vi.fn(),
  deleteCognitoCredential: vi.fn(),
  deleteClient: vi.fn(),
  RotationError: MockRotationError
}))

describe('Client Routes', () => {
  let clientService
  let clients

  beforeAll(async () => {
    clientService = await import('#/services/clients.js')
    ;({ clients } = await import('./clients.js'))
  })

  const clientRecord = {
    clientName: 'Test Client',
    clientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
    tenantServiceName: 'waste-movement-external-api'
  }
  const request = {
    params: {
      tenantServiceName: clientRecord.tenantServiceName,
      clientId: clientRecord.clientId
    }
  }
  const h = {
    response: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis()
  }
  const errorMessage = 'Internal Server Error'

  describe('GET Client', () => {
    it('should return a client when client is found', async () => {
      vi.spyOn(clientService, 'findClient').mockReturnValue(clientRecord)

      await clients[1].handler(request, h)

      expect(h.response).toHaveBeenCalledWith(clientRecord)
    })

    it('should return only the published fields of the stored client', async () => {
      vi.spyOn(clientService, 'findClient').mockReturnValue({
        ...clientRecord,
        lastSynced: '2026-10-15T12:00:00Z'
      })

      await clients[1].handler(request, h)

      expect(h.response).toHaveBeenCalledWith(clientRecord)
    })

    it('should return a 404 error when client is not found', async () => {
      vi.spyOn(clientService, 'findClient').mockReturnValue(undefined)

      const result = await clients[1].handler(request, h)

      expect(result.output.payload).toEqual({
        error: 'Not Found',
        message: 'Not Found',
        statusCode: 404
      })
    })

    it('should return a 500 error when an error is thrown', async () => {
      vi.spyOn(clientService, 'findClient').mockImplementation(() => {
        throw new Error(errorMessage)
      })

      const result = await clients[1].handler(request, h)

      expect(result.output.payload).toEqual({
        error: 'Internal Server Error',
        message: 'An internal server error occurred',
        statusCode: 500
      })
    })
  })
})

describe('GET Clients for a user pool', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  const clientRecords = [
    {
      clientName: 'Test Client One',
      clientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
      tenantServiceName: 'waste-movement-external-api'
    },
    {
      clientName: 'Test Client Two',
      clientId: '2a2b3c4d5e6f7g8h9i0j1k2l3m',
      tenantServiceName: 'waste-movement-external-api'
    }
  ]
  const otherPoolRecord = {
    clientName: 'Test Client Three',
    clientId: '3a2b3c4d5e6f7g8h9i0j1k2l3m',
    tenantServiceName: 'waste-movement-backend-service'
  }

  let clientService
  let server

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb
    clientService = await import('#/services/clients.js')
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  beforeEach(async () => {
    await server.db.collection('clients').deleteMany({})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Should return all clients for the user pool', async () => {
    await server.db
      .collection('clients')
      .insertMany(structuredClone([...clientRecords, otherPoolRecord]))

    const response = await server.inject({
      method: 'GET',
      url: `/clients/${clientRecords[0].tenantServiceName}`,
      auth
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual(clientRecords)
  })

  test('Should return only the published fields of stored clients', async () => {
    await server.db
      .collection('clients')
      .insertOne({ ...clientRecords[0], lastSynced: '2026-10-15T12:00:00Z' })

    const response = await server.inject({
      method: 'GET',
      url: `/clients/${clientRecords[0].tenantServiceName}`,
      auth
    })

    expect(JSON.parse(response.payload)).toStrictEqual([clientRecords[0]])
  })

  test('Should return a 404 error when the user pool has no clients', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/clients/${clientRecords[0].tenantServiceName}`,
      auth
    })

    expect(response.statusCode).toBe(404)
  })

  test('Should return a 500 error when an error is thrown', async () => {
    vi.spyOn(clientService, 'findClients').mockImplementation(() => {
      throw new Error('Something went wrong')
    })

    const response = await server.inject({
      method: 'GET',
      url: `/clients/${clientRecords[0].tenantServiceName}`,
      auth
    })

    expect(response.statusCode).toBe(500)
  })

  test('Should return a 401 error without credentials', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/clients/${clientRecords[0].tenantServiceName}`
    })

    expect(response.statusCode).toBe(401)
  })
})
describe('POST Clients sync', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  let server
  let allCognitoCredentials
  let clientSyncService

  beforeAll(async () => {
    allCognitoCredentials = (await import('#/common/helpers/cognito-client.js'))
      .allCognitoCredentials
    clientSyncService = await import('#/services/client-sync.js')
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Should return all synced clients', async () => {
    allCognitoCredentials.mockResolvedValue([
      { clientName: 'Client One', clientId: 'client-1' },
      { clientName: 'Client Two', clientId: 'client-2' }
    ])

    const response = await server.inject({
      method: 'POST',
      url: `/clients/sync`,
      auth
    })

    expect(response.statusCode).toBe(200)
    expect(allCognitoCredentials).toHaveBeenCalled()

    const payload = JSON.parse(response.payload)

    expect(payload.result.totalServicesProcessed).toBeGreaterThan(0)
    expect(payload.result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ credentialsSynced: 2 })
      ])
    )
  })
  test('Should return zero credentials synced when Cognito returns no client details', async () => {
    allCognitoCredentials.mockResolvedValue(undefined)

    const response = await server.inject({
      method: 'POST',
      url: `/clients/sync`,
      auth
    })

    expect(response.statusCode).toBe(200)

    const payload = JSON.parse(response.payload)

    expect(payload.result.totalServicesProcessed).toBe(1)
    expect(payload.result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialsSynced: 0,
          serviceName: 'waste-movement-external-api'
        })
      ])
    )
  })

  test('Should return a 401 error without credentials', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/clients/sync`
    })

    expect(response.statusCode).toBe(401)
  })

  test('Should return a 500 error when an error is thrown', async () => {
    vi.spyOn(clientSyncService, 'sync').mockImplementation(() => {
      throw new Error('Something went wrong')
    })

    const response = await server.inject({
      method: 'POST',
      url: `/clients/sync`,
      auth
    })

    expect(response.statusCode).toBe(500)
  })
})

describe('POST Clients', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  let server
  let createCognitoCredential
  let clientSyncService
  let allCognitoCredentials

  beforeAll(async () => {
    createCognitoCredential = (
      await import('#/common/helpers/cognito-client.js')
    ).createCognitoCredential
    allCognitoCredentials = (await import('#/common/helpers/cognito-client.js'))
      .allCognitoCredentials
    clientSyncService = await import('#/services/client-sync.js')
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    vi.spyOn(clientSyncService, 'sync').mockResolvedValue({
      totalServicesProcessed: 0,
      services: []
    })

    createCognitoCredential.mockResolvedValue([
      {
        clientName: 'goodName1-_.',
        clientId: 'my_client_id',
        clientSecret: 'my_client_secret'
      }
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("rejects client names that don't match the regex pattern ^[\\w.-]+$", async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'badName1 =(^@+@^)='
      }
    })

    expect(response.statusCode).toBe(400)
    const responseBody = JSON.parse(response.payload)

    expect(responseBody?.error).toBe('Bad Request')
    expect(responseBody?.message).toBe(
      'clientName must fit the regex pattern ^[\\w.-]+$'
    )

    expect(clientSyncService.sync).not.toHaveBeenCalled()
  })

  it('rejects client names longer than 128 characters', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'x'.repeat(129)
      }
    })

    expect(response.statusCode).toBe(400)
    const responseBody = JSON.parse(response.payload)

    expect(responseBody?.error).toBe('Bad Request')
    expect(responseBody?.message).toBe(
      'clientName must be 128 characters or fewer'
    )
  })

  it('returns a 409 error when a client name already exists (case-insensitive)', async () => {
    allCognitoCredentials.mockResolvedValueOnce([
      { clientName: 'Existing-Client', clientId: 'existing-id' }
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'existing-client'
      }
    })

    expect(response.statusCode).toBe(409)
    const responseBody = JSON.parse(response.payload)
    expect(responseBody?.error).toBe('Conflict')
    expect(responseBody?.message).toContain('already exists (case insensitive)')
    expect(createCognitoCredential).not.toHaveBeenCalled()
    expect(clientSyncService.sync).not.toHaveBeenCalled()
  })

  it('creates the client when Cognito returns no client details to check', async () => {
    allCognitoCredentials.mockResolvedValueOnce(undefined)

    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'goodName1-_.'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(createCognitoCredential).toHaveBeenCalled()
  })

  it('syncs database when validation passes', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'goodName1-_.'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(clientSyncService.sync).toHaveBeenCalled()
  })

  it('returns created cognito credentials', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'goodName1-_.'
      }
    })

    const responseBody = JSON.parse(response.payload)
    expect(responseBody).toStrictEqual({
      clientName: 'goodName1-_.',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret'
    })
    expect(clientSyncService.sync).toHaveBeenCalled()
  })

  it('logs an error but still returns when sync fails', async () => {
    vi.spyOn(clientSyncService, 'sync').mockRejectedValue(
      new Error('Sync failed')
    )

    const response = await server.inject({
      method: 'POST',
      url: '/clients/myTenantServiceName',
      auth,
      payload: {
        clientName: 'goodName1-_.'
      }
    })

    expect(response.statusCode).toBe(200)
    const responseBody = JSON.parse(response.payload)
    expect(responseBody).toStrictEqual({
      clientName: 'goodName1-_.',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret'
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Sync failed with error: Sync failed'
    )
  })
})

describe('POST Clients rotate', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  const tenantServiceName = 'waste-movement-external-api'
  const clientId = 'my_client_id'
  const url = `/clients/${tenantServiceName}/${clientId}/rotate`
  const rotatedClient = {
    clientName: 'Test Client',
    clientId,
    clientSecret: 'my_new_client_secret'
  }
  // What the endpoint returns for rotatedClient
  const rotatedCredentials = {
    clientName: 'Test Client',
    clientId,
    clientSecret: 'my_new_client_secret'
  }
  let server
  let rotateCognitoCredential
  let clientService

  beforeAll(async () => {
    rotateCognitoCredential = (
      await import('#/common/helpers/cognito-client.js')
    ).rotateCognitoCredential
    clientService = await import('#/services/clients.js')
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    vi.spyOn(clientService, 'findClient').mockResolvedValue({
      clientName: 'Test Client',
      clientId,
      tenantServiceName
    })

    rotateCognitoCredential.mockResolvedValue([rotatedClient])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the rotated credentials', async () => {
    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual(rotatedCredentials)
    expect(rotateCognitoCredential).toHaveBeenCalledWith(
      tenantServiceName,
      'Test Client'
    )
  })

  it('returns only the client fields, not anything else', async () => {
    rotateCognitoCredential.mockResolvedValue([
      { ...rotatedClient, createdAt: '2026-10-14T12:00:00Z' }
    ])

    const response = await server.inject({ method: 'POST', url, auth })

    expect(JSON.parse(response.payload)).toStrictEqual(rotatedCredentials)
  })

  it('returns a 404 error without rotating when the client is not stored', async () => {
    clientService.findClient.mockResolvedValue(null)

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(404)
    expect(rotateCognitoCredential).not.toHaveBeenCalled()
  })

  it('returns a 404 error when Cognito skips the client', async () => {
    rotateCognitoCredential.mockResolvedValue([])

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(404)
  })

  it('returns only this client and warns when others share its name', async () => {
    rotateCognitoCredential.mockResolvedValue([
      {
        clientName: 'Test Client',
        clientId: 'other_client_id',
        clientSecret: 'other_secret'
      },
      rotatedClient
    ])

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual(rotatedCredentials)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      `Rotating client ${clientId} also rotated 1 other client(s) with the same name`
    )
  })

  it('returns a 500 error when an unexpected error is thrown', async () => {
    rotateCognitoCredential.mockRejectedValue(new Error('Unexpected error'))

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(500)
  })

  it('returns a 502 error saying nothing was rotated when CDP refuses', async () => {
    rotateCognitoCredential.mockRejectedValue(
      new MockRotationError('Refused', { outcomeUnknown: false })
    )

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload).message).toBe(
      'CDP refused the rotation request'
    )
  })

  it('returns a 502 error warning against blind retries when the outcome is unknown', async () => {
    rotateCognitoCredential.mockRejectedValue(
      new MockRotationError('Timed out', { outcomeUnknown: true })
    )

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload).message).toBe(
      'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'
    )
  })

  it('returns a 502 error with an unknown outcome when CDP succeeds without client details', async () => {
    rotateCognitoCredential.mockResolvedValue(undefined)

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload).message).toBe(
      'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'
    )
  })

  it('returns a 409 error when CDP rotates a different client with the stored name', async () => {
    rotateCognitoCredential.mockResolvedValue([
      {
        clientName: 'Test Client',
        clientId: 'other_client_id',
        clientSecret: 'other_secret'
      }
    ])

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.payload).message).toBe(
      'The stored client is out of date: its name belongs to a different client'
    )
  })

  it('tells clients not to store the response', async () => {
    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('logs who requested the rotation, without the secret', async () => {
    await server.inject({ method: 'POST', url, auth })

    expect(mockLogger.info).toHaveBeenCalledWith(
      `Client secret rotation requested by test for client ${clientId} of ${tenantServiceName}`
    )
    const loggedText = JSON.stringify(mockLogger.info.mock.calls)
    expect(loggedText).not.toContain(rotatedClient.clientSecret)
  })

  it.each([
    ['tenantServiceName', '/clients/Not_A_Service/my_client_id/rotate'],
    ['tenantServiceName', '/clients/..%2Ftenants/my_client_id/rotate'],
    ['clientId', `/clients/${tenantServiceName}/not.a.client/rotate`]
  ])('returns a 400 error for an invalid %s (%s)', async (_, invalidUrl) => {
    const response = await server.inject({
      method: 'POST',
      url: invalidUrl,
      auth
    })

    expect(response.statusCode).toBe(400)
    expect(clientService.findClient).not.toHaveBeenCalled()
    expect(rotateCognitoCredential).not.toHaveBeenCalled()
  })

  it('returns a 401 error without credentials', async () => {
    const response = await server.inject({ method: 'POST', url })

    expect(response.statusCode).toBe(401)
  })
})

describe('DELETE Clients', () => {
  let clientService
  let deleteCognitoCredential
  let server
  let deleteClientService

  beforeAll(async () => {
    clientService = await import('#/services/clients.js')
    deleteCognitoCredential = (
      await import('#/common/helpers/cognito-client.js')
    ).deleteCognitoCredential
    deleteClientService = await import('#/services/client-delete.js')

    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  const clientRecord = {
    clientName: 'Test Client',
    clientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
    tenantServiceName: 'waste-movement-external-api'
  }
  const auth = { strategy: 'basic', credentials: { username: 'test' } }

  it('successfully deletes and syncs an existant client', async () => {
    vi.spyOn(clientService, 'findClient').mockResolvedValue(clientRecord)
    deleteCognitoCredential.mockResolvedValueOnce(true)
    vi.spyOn(deleteClientService, 'deleteClient').mockResolvedValueOnce({
      deletedCount: 1
    })

    const response = await server.inject({
      method: 'DELETE',
      url: `/clients/${clientRecord.tenantServiceName}/${clientRecord.clientId}`,
      auth
    })

    // 204 - Return with no content
    expect(response.statusCode).toBe(204)
    expect(deleteCognitoCredential).toHaveBeenCalledWith(
      clientRecord.tenantServiceName,
      clientRecord.clientName
    )
    expect(deleteClientService.deleteClient.mock.calls[0][1]).toStrictEqual(
      clientRecord.clientId
    )
    expect(deleteClientService.deleteClient.mock.calls[0][2]).toStrictEqual(
      clientRecord.tenantServiceName
    )
  })

  it("raises an error if the client doesn't exist", async () => {
    vi.spyOn(clientService, 'findClient').mockResolvedValue(undefined)

    const response = await server.inject({
      method: 'DELETE',
      url: `/clients/${clientRecord.tenantServiceName}/${clientRecord.clientId}`,
      auth
    })

    expect(response.statusCode).toBe(404)
  })

  it('raises an error if searching for the client id fails', async () => {
    vi.spyOn(clientService, 'findClient').mockRejectedValue(
      new Error('Database error')
    )

    const response = await server.inject({
      method: 'DELETE',
      url: `/clients/${clientRecord.tenantServiceName}/${clientRecord.clientId}`,
      auth
    })

    expect(response.statusCode).toBe(500)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Deleting client failed with error: Database error'
    )
  })

  it('raises an error if deleteCognitoCredentials fails', async () => {
    vi.spyOn(clientService, 'findClient').mockResolvedValue(clientRecord)
    deleteCognitoCredential.mockRejectedValue(new Error('Cognito error'))

    const response = await server.inject({
      method: 'DELETE',
      url: `/clients/${clientRecord.tenantServiceName}/${clientRecord.clientId}`,
      auth
    })

    expect(response.statusCode).toBe(500)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Deleting client failed with error: Cognito error'
    )
  })

  it('succeeds but logs an error if deleting in cognito succeeds but cache deletion fails', async () => {
    vi.spyOn(clientService, 'findClient').mockResolvedValue(clientRecord)
    deleteCognitoCredential.mockResolvedValue(true)
    vi.spyOn(deleteClientService, 'deleteClient').mockRejectedValue(
      new Error('Cache delete failed')
    )

    const response = await server.inject({
      method: 'DELETE',
      url: `/clients/${clientRecord.tenantServiceName}/${clientRecord.clientId}`,
      auth
    })

    expect(response.statusCode).toBe(204)
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Deleting client from cache failed with error: Cache delete failed'
    )
  })
})

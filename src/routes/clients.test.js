const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn()
}

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const { MockCdpError } = vi.hoisted(() => ({
  MockCdpError: class extends Error {
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
  purgeCognitoCredential: vi.fn(),
  deleteCognitoCredential: vi.fn(),
  deleteClient: vi.fn(),
  CdpError: MockCdpError
}))

vi.mock('#/services/client-directory.js', () => ({
  listClients: vi.fn().mockResolvedValue([])
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
        message: `Client '${clientRecord.clientId}' not found for tenant service '${clientRecord.tenantServiceName}'`,
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

  test('Should return an empty list when the user pool has no clients', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/clients/${clientRecords[0].tenantServiceName}`,
      auth
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual([])
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
  let clientService
  let allCognitoCredentials
  let listClients

  beforeAll(async () => {
    clientService = await import('#/services/clients.js')
    ;({ listClients } = await import('#/services/client-directory.js'))
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
    vi.spyOn(clientService, 'saveClient').mockResolvedValue()
    vi.spyOn(clientService, 'findClients').mockResolvedValue([])

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
      url: '/clients/waste-movement-external-api',
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
      url: '/clients/waste-movement-external-api',
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

  it('returns a 409 error when another client already has the name (case-insensitive)', async () => {
    listClients.mockResolvedValueOnce([
      { clientName: 'Existing-Client', clientId: 'existing-id' }
    ])

    const response = await server.inject({
      method: 'POST',
      url: '/clients/waste-movement-external-api',
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

  it("checks names against the client directory, not CDP's list or the stored clients", async () => {
    await server.inject({
      method: 'POST',
      url: '/clients/waste-movement-external-api',
      auth,
      payload: { clientName: 'goodName1-_.' }
    })

    expect(listClients).toHaveBeenCalledWith('waste-movement-external-api')
    expect(allCognitoCredentials).not.toHaveBeenCalled()
    expect(clientService.findClients).not.toHaveBeenCalled()
  })

  const createClient = () =>
    server.inject({
      method: 'POST',
      url: '/clients/waste-movement-external-api',
      auth,
      payload: {
        clientName: 'goodName1-_.'
      }
    })

  const createOutcomeUnknownMessage =
    "Create outcome unknown: the client may have been created, but its secret couldn't be returned. It can't be found or rotated here until the next sync (or POST /clients/sync). If it exists then, rotate its secret."
  const createNoSecretMessage =
    "The client was created, but CDP didn't return its secret. Rotate its secret to get one."

  it("returns a 500 error without creating the client when the clients can't be listed", async () => {
    listClients.mockRejectedValueOnce(new Error('Cognito down'))

    const response = await createClient()

    expect(response.statusCode).toBe(500)
    expect(createCognitoCredential).not.toHaveBeenCalled()
  })

  it('ignores a client with no name when checking for duplicates', async () => {
    listClients.mockResolvedValueOnce([{ clientId: 'nameless-id' }])

    const response = await createClient()

    expect(response.statusCode).toBe(200)
    expect(createCognitoCredential).toHaveBeenCalled()
  })

  it('returns a 502 error saying nothing was created when CDP refuses', async () => {
    createCognitoCredential.mockRejectedValueOnce(
      new MockCdpError('Refused', { outcomeUnknown: false })
    )

    const response = await createClient()

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload)).toMatchObject({
      message: 'CDP refused the create request, so no client was created',
      outcome: 'failure'
    })
  })

  it.each([
    [
      'CDP may have created the client',
      () =>
        Promise.reject(new MockCdpError('Timed out', { outcomeUnknown: true })),
      { saves: false, message: createOutcomeUnknownMessage, outcome: 'unknown' }
    ],
    [
      "CDP's response has no client details",
      () => Promise.resolve(undefined),
      { saves: false, message: createOutcomeUnknownMessage, outcome: 'unknown' }
    ],
    [
      "CDP's response has no secret for the client",
      () =>
        Promise.resolve([
          { clientName: 'goodName1-_.', clientId: 'my_client_id' }
        ]),
      { saves: true, message: createNoSecretMessage, outcome: 'success' }
    ],
    [
      "CDP's response has a secret but no client id",
      () =>
        Promise.resolve([
          { clientName: 'goodName1-_.', clientSecret: 'my_client_secret' }
        ]),
      { saves: false, message: createOutcomeUnknownMessage, outcome: 'unknown' }
    ],
    [
      "CDP's response is for a different client",
      () =>
        Promise.resolve([
          {
            clientName: 'otherName',
            clientId: 'other_client_id',
            clientSecret: 'other_secret'
          }
        ]),
      { saves: false, message: createOutcomeUnknownMessage, outcome: 'unknown' }
    ]
  ])(
    'returns a 502 error when %s',
    async (_, create, { saves, message, outcome }) => {
      createCognitoCredential.mockImplementationOnce(create)

      const response = await createClient()

      expect(response.statusCode).toBe(502)
      expect(JSON.parse(response.payload)).toMatchObject({ message, outcome })
      expect(clientService.saveClient).toHaveBeenCalledTimes(saves ? 1 : 0)
      expect(clientSyncService.sync).not.toHaveBeenCalled()
    }
  )

  it('returns a 409 error when CDP skips the name because it already exists', async () => {
    createCognitoCredential.mockResolvedValueOnce([])

    const response = await createClient()

    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.payload).message).toBe(
      "Client name 'goodName1-_.' already exists (case insensitive)"
    )
    expect(clientService.saveClient).not.toHaveBeenCalled()
    expect(clientSyncService.sync).not.toHaveBeenCalled()
  })

  it('still returns a 502 error when saving a client without a secret fails', async () => {
    createCognitoCredential.mockResolvedValueOnce([
      { clientName: 'goodName1-_.', clientId: 'my_client_id' }
    ])
    clientService.saveClient.mockRejectedValue(new Error('Mongo down'))

    const response = await createClient()

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload)).toMatchObject({
      message: createNoSecretMessage,
      outcome: 'success',
      clientId: 'my_client_id'
    })
  })

  it('tells clients not to store the response', async () => {
    const response = await createClient()

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it("saves the created client's record, without syncing", async () => {
    const response = await createClient()

    expect(response.statusCode).toBe(200)
    expect(clientService.saveClient).toHaveBeenCalledWith(expect.anything(), {
      clientId: 'my_client_id',
      clientName: 'goodName1-_.',
      secrets: [],
      tenantServiceName: 'waste-movement-external-api'
    })
    expect(clientSyncService.sync).not.toHaveBeenCalled()
  })

  it('returns created cognito credentials', async () => {
    const response = await createClient()

    expect(JSON.parse(response.payload)).toStrictEqual({
      clientName: 'goodName1-_.',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret'
    })
  })

  it('stores the created client so it can be fetched straight away', async () => {
    clientService.saveClient.mockRestore()

    await createClient()
    await createClient()

    const response = await server.inject({
      method: 'GET',
      url: '/clients/waste-movement-external-api/my_client_id',
      auth
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual({
      clientId: 'my_client_id',
      clientName: 'goodName1-_.',
      secrets: [],
      tenantServiceName: 'waste-movement-external-api'
    })
    // Saving the same client twice leaves one record
    expect(
      await server.db
        .collection('clients')
        .countDocuments({ clientId: 'my_client_id' })
    ).toBe(1)

    await server.db
      .collection('clients')
      .deleteMany({ clientId: 'my_client_id' })
  })

  it('logs an error but still returns the secret when saving fails', async () => {
    clientService.saveClient.mockRejectedValue(new Error('Mongo down'))

    const response = await createClient()

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual({
      clientName: 'goodName1-_.',
      clientId: 'my_client_id',
      clientSecret: 'my_client_secret'
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Saving created client failed: Mongo down'
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
    expect(JSON.parse(response.payload).message).toBe(
      `Client '${clientId}' not found for tenant service '${tenantServiceName}'`
    )
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
      new MockCdpError('Refused', { outcomeUnknown: false })
    )

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload)).toMatchObject({
      message: 'CDP refused the rotation request',
      outcome: 'failure'
    })
  })

  it('returns a 502 error warning against blind retries when the outcome is unknown', async () => {
    rotateCognitoCredential.mockRejectedValue(
      new MockCdpError('Timed out', { outcomeUnknown: true })
    )

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload)).toMatchObject({
      message:
        'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.',
      outcome: 'unknown'
    })
  })

  it('returns a 502 error with an unknown outcome when CDP succeeds without client details', async () => {
    rotateCognitoCredential.mockResolvedValue(undefined)

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(502)
    expect(JSON.parse(response.payload)).toMatchObject({
      message:
        'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.',
      outcome: 'unknown'
    })
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

describe('POST Clients purge', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  const tenantServiceName = 'waste-movement-external-api'
  const clientId = 'my_client_id'
  const url = `/clients/${tenantServiceName}/${clientId}/purge`
  const storedClient = {
    clientName: 'Test Client',
    clientId,
    tenantServiceName
  }
  let server
  let clientService
  let purgeService
  let PurgeOutcome

  beforeAll(async () => {
    clientService = await import('#/services/clients.js')
    purgeService = await import('#/services/client-purge.js')
    ;({ PurgeOutcome } = await import('#/domain/client-secrets.js'))
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    vi.spyOn(clientService, 'findClient').mockResolvedValue(storedClient)
    vi.spyOn(purgeService, 'purgeOldSecret').mockResolvedValue(
      PurgeOutcome.PURGED
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const inject = () => server.inject({ method: 'POST', url, auth })
  const message = (response) => JSON.parse(response.payload).message

  it('purges the stored client and returns no content', async () => {
    const response = await inject()

    expect(response.statusCode).toBe(204)
    expect(purgeService.purgeOldSecret).toHaveBeenCalledWith(
      tenantServiceName,
      storedClient
    )
  })

  it.each([
    ['NOT_IN_CDP', 404, `Client '${clientId}' not found in CDP`],
    [
      'NAME_REUSED',
      409,
      "The stored client is out of date: its name belongs to a different client, and that client's older secrets may have been removed"
    ],
    [
      'NAME_SHARED',
      409,
      "Another client is named 'Test Client' (case insensitive), and CDP removes secrets by name, so no secret was removed"
    ],
    [
      'OUTCOME_UNKNOWN',
      502,
      'Purge outcome unknown: the older secret may have been removed. It is safe to try again.'
    ]
  ])('returns %s as a %i error', async (outcome, statusCode, expected) => {
    purgeService.purgeOldSecret.mockResolvedValue(PurgeOutcome[outcome])

    const response = await inject()

    expect(response.statusCode).toBe(statusCode)
    expect(message(response)).toBe(expected)
    // Only a 502 says whether the change happened
    expect(JSON.parse(response.payload).outcome).toBe(
      statusCode === 502 ? 'unknown' : undefined
    )
  })

  it('returns a 404 error without purging when the client is not stored', async () => {
    clientService.findClient.mockResolvedValue(null)

    const response = await inject()

    expect(response.statusCode).toBe(404)
    expect(message(response)).toBe(
      `Client '${clientId}' not found for tenant service '${tenantServiceName}'`
    )
    expect(purgeService.purgeOldSecret).not.toHaveBeenCalled()
  })

  it('returns a 502 error saying nothing was removed when CDP refuses', async () => {
    purgeService.purgeOldSecret.mockRejectedValue(
      new MockCdpError('Refused', { outcomeUnknown: false })
    )

    const response = await inject()

    expect(response.statusCode).toBe(502)
    expect(message(response)).toBe(
      'CDP refused the purge request, so no secret was removed'
    )
    expect(JSON.parse(response.payload).outcome).toBe('failure')
  })

  it('returns a 502 error saying it is safe to retry when the outcome is unknown', async () => {
    purgeService.purgeOldSecret.mockRejectedValue(
      new MockCdpError('Timed out', { outcomeUnknown: true })
    )

    const response = await inject()

    expect(response.statusCode).toBe(502)
    expect(message(response)).toBe(
      'Purge outcome unknown: the older secret may have been removed. It is safe to try again.'
    )
    expect(JSON.parse(response.payload).outcome).toBe('unknown')
  })

  it('returns a 500 error for an outcome it does not know', async () => {
    purgeService.purgeOldSecret.mockResolvedValue('not an outcome')

    const response = await inject()

    expect(response.statusCode).toBe(500)
  })

  it('returns a 500 error when an unexpected error is thrown', async () => {
    purgeService.purgeOldSecret.mockRejectedValue(new Error('Unexpected'))

    const response = await inject()

    expect(response.statusCode).toBe(500)
  })

  it('logs who requested the purge', async () => {
    await inject()

    expect(mockLogger.info).toHaveBeenCalledWith(
      `Old client secret purge requested by test for client ${clientId} of ${tenantServiceName}`
    )
  })

  it.each([
    ['tenantServiceName', '/clients/Not_A_Service/my_client_id/purge'],
    ['clientId', `/clients/${tenantServiceName}/not.a.client/purge`]
  ])('returns a 400 error for an invalid %s (%s)', async (_, invalidUrl) => {
    const response = await server.inject({
      method: 'POST',
      url: invalidUrl,
      auth
    })

    expect(response.statusCode).toBe(400)
    expect(clientService.findClient).not.toHaveBeenCalled()
    expect(purgeService.purgeOldSecret).not.toHaveBeenCalled()
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
    expect(JSON.parse(response.payload).message).toBe(
      `Client '${clientRecord.clientId}' not found for tenant service '${clientRecord.tenantServiceName}'`
    )
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

describe('Routes for a tenant service', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  let server
  let cognitoClient
  let clientService

  beforeAll(async () => {
    cognitoClient = await import('#/common/helpers/cognito-client.js')
    clientService = await import('#/services/clients.js')
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['GET', '/clients/waste-movement-backend'],
    ['GET', '/clients/waste-movement-backend/my_client_id'],
    ['POST', '/clients/waste-movement-backend'],
    ['DELETE', '/clients/waste-movement-backend/my_client_id'],
    ['POST', '/clients/waste-movement-backend/my_client_id/rotate'],
    ['POST', '/clients/waste-movement-backend/my_client_id/purge']
  ])(
    'returns a 404 error naming a service it does not manage (%s %s)',
    async (method, url) => {
      vi.spyOn(clientService, 'findClient')
      vi.spyOn(clientService, 'findClients')

      const response = await server.inject({
        method,
        url,
        auth,
        payload: method === 'POST' ? { clientName: 'goodName1-_.' } : undefined
      })

      expect(response.statusCode).toBe(404)
      expect(JSON.parse(response.payload).message).toBe(
        "Tenant service 'waste-movement-backend' is not managed by dwt-client-sync"
      )
      expect(clientService.findClient).not.toHaveBeenCalled()
      expect(clientService.findClients).not.toHaveBeenCalled()
      expect(cognitoClient.allCognitoCredentials).not.toHaveBeenCalled()
      expect(cognitoClient.createCognitoCredential).not.toHaveBeenCalled()
      expect(cognitoClient.rotateCognitoCredential).not.toHaveBeenCalled()
      expect(cognitoClient.purgeCognitoCredential).not.toHaveBeenCalled()
      expect(cognitoClient.deleteCognitoCredential).not.toHaveBeenCalled()
    }
  )
})

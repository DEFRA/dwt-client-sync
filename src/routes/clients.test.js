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
  allCognitoCredentials: vi.fn(),
  rotateCognitoCredential: vi.fn(),
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
    allCognitoCredentials.mockResolvedValue({
      client_details: [
        { client_name: 'Client One', client_id: 'client-1' },
        { client_name: 'Client Two', client_id: 'client-2' }
      ]
    })

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
    allCognitoCredentials.mockResolvedValue({ body: { client_details: [] } })

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

describe('POST Clients rotate', () => {
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  const tenantServiceName = 'waste-movement-external-api'
  const clientId = 'my_client_id'
  const url = `/clients/${tenantServiceName}/${clientId}/rotate`
  const rotatedClient = {
    client_name: 'Test Client',
    client_id: clientId,
    client_secret: 'my_new_client_secret'
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

    rotateCognitoCredential.mockResolvedValue({
      cognito_user_pool_id: 'eu-west-2_EXAMPLE01',
      request_id: 'my_request_id',
      tenant_service_name: tenantServiceName,
      client_details: [rotatedClient]
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the rotated credentials', async () => {
    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual(rotatedClient)
    expect(rotateCognitoCredential).toHaveBeenCalledWith(
      tenantServiceName,
      'Test Client'
    )
  })

  it('returns a 404 error without rotating when the client is not stored', async () => {
    clientService.findClient.mockResolvedValue(null)

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(404)
    expect(rotateCognitoCredential).not.toHaveBeenCalled()
  })

  it('returns a 404 error when Cognito skips the client', async () => {
    rotateCognitoCredential.mockResolvedValue({ client_details: [] })

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(404)
  })

  it('returns only this client and warns when others share its name', async () => {
    rotateCognitoCredential.mockResolvedValue({
      client_details: [
        {
          client_name: 'Test Client',
          client_id: 'other_client_id',
          client_secret: 'other_secret'
        },
        rotatedClient
      ]
    })

    const response = await server.inject({ method: 'POST', url, auth })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toStrictEqual(rotatedClient)
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

  it.each([
    ['no payload', null],
    ['no client details', { request_id: 'my_request_id' }]
  ])(
    'returns a 502 error with an unknown outcome when CDP succeeds with %s',
    async (_, payload) => {
      rotateCognitoCredential.mockResolvedValue(payload)

      const response = await server.inject({ method: 'POST', url, auth })

      expect(response.statusCode).toBe(502)
      expect(JSON.parse(response.payload).message).toBe(
        'Rotation outcome unknown: a new secret may have been issued. Check the client before retrying.'
      )
    }
  )

  it('returns a 409 error when CDP rotates a different client with the stored name', async () => {
    rotateCognitoCredential.mockResolvedValue({
      client_details: [
        {
          client_name: 'Test Client',
          client_id: 'other_client_id',
          client_secret: 'other_secret'
        }
      ]
    })

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
    expect(loggedText).not.toContain(rotatedClient.client_secret)
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

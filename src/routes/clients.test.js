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

      await clients[0].handler(request, h)

      expect(h.response).toHaveBeenCalledWith(clientRecord)
    })

    it('should return a 404 error when client is not found', async () => {
      vi.spyOn(clientService, 'findClient').mockReturnValue(undefined)

      const result = await clients[0].handler(request, h)

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

      const result = await clients[0].handler(request, h)

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

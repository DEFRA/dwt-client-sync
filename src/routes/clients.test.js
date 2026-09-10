describe('Client Routes', () => {
  let clientService
  let clients

  beforeAll(async () => {
    clientService = await import('#/services/clients.js')
    ;({ clients } = await import('./clients.js'))
  })

  const userPoolId = 123
  const clientId = 456
  const clientRecord = {
    UserPoolClient: {
      UserPoolId: userPoolId,
      ClientName: 'Test Client',
      ClientId: clientId,
      LastModifiedDate: '2026-07-10T08:41:31.618Z',
      CreationDate: '2026-05-19T08:25:53.785Z'
    }
  }
  const request = { params: { userPoolId, clientId } }
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
  const userPoolId = 'eu-west-2_testPool'
  const auth = { strategy: 'basic', credentials: { username: 'test' } }
  const clientRecords = [
    {
      UserPoolClient: {
        UserPoolId: userPoolId,
        ClientName: 'Client One',
        ClientId: 'client-1',
        LastModifiedDate: new Date('2026-07-10T08:41:31.618Z'),
        CreationDate: new Date('2026-05-19T08:25:53.785Z')
      }
    },
    {
      UserPoolClient: {
        UserPoolId: userPoolId,
        ClientName: 'Client Two',
        ClientId: 'client-2',
        LastModifiedDate: new Date('2026-08-01T10:00:00.000Z'),
        CreationDate: new Date('2026-06-01T10:00:00.000Z')
      }
    }
  ]
  const otherPoolRecord = {
    UserPoolClient: {
      UserPoolId: 'eu-west-2_otherPool',
      ClientName: 'Other Client',
      ClientId: 'client-3',
      LastModifiedDate: new Date('2026-08-01T10:00:00.000Z'),
      CreationDate: new Date('2026-06-01T10:00:00.000Z')
    }
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
      url: `/clients/${userPoolId}`,
      auth
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual([
      {
        UserPoolClient: {
          UserPoolId: userPoolId,
          ClientName: 'Client One',
          ClientId: 'client-1',
          LastModifiedDate: '2026-07-10T08:41:31.618Z',
          CreationDate: '2026-05-19T08:25:53.785Z'
        }
      },
      {
        UserPoolClient: {
          UserPoolId: userPoolId,
          ClientName: 'Client Two',
          ClientId: 'client-2',
          LastModifiedDate: '2026-08-01T10:00:00.000Z',
          CreationDate: '2026-06-01T10:00:00.000Z'
        }
      }
    ])
  })

  test('Should return a 404 error when the user pool has no clients', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/clients/${userPoolId}`,
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
      url: `/clients/${userPoolId}`,
      auth
    })

    expect(response.statusCode).toBe(500)
  })

  test('Should return a 401 error without credentials', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/clients/${userPoolId}`
    })

    expect(response.statusCode).toBe(401)
  })
})

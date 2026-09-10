import { mockClient } from 'aws-sdk-client-mock'
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  InternalErrorException,
  ListUserPoolClientsCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-cognito-identity-provider'

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

describe('#clients routes', () => {
  const cognitoMock = mockClient(CognitoIdentityProviderClient)
  const userPoolId = 'eu-west-2_testPool'
  const auth = { strategy: 'basic', credentials: { username: 'test' } }

  let server

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    cognitoMock.reset()
  })

  test('Should return the user pool clients', async () => {
    cognitoMock.on(ListUserPoolClientsCommand).resolves({
      UserPoolClients: [
        {
          ClientId: 'client-1',
          ClientName: 'Client One',
          UserPoolId: userPoolId
        }
      ]
    })
    cognitoMock.on(DescribeUserPoolClientCommand).resolves({
      UserPoolClient: {
        UserPoolId: userPoolId,
        ClientName: 'Client One',
        ClientId: 'client-1',
        LastModifiedDate: new Date('2026-07-10T08:41:31.618Z'),
        CreationDate: new Date('2026-05-19T08:25:53.785Z')
      }
    })

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
      }
    ])
  })

  test('Should return 404 with no body when the user pool does not exist', async () => {
    cognitoMock.on(ListUserPoolClientsCommand).rejects(
      new ResourceNotFoundException({
        message: 'User pool does not exist.',
        $metadata: {}
      })
    )

    const response = await server.inject({
      method: 'GET',
      url: `/clients/${userPoolId}`,
      auth
    })

    expect(response.statusCode).toBe(404)
    expect(response.payload).toBe('')
  })

  test('Should return 500 when Cognito fails unexpectedly', async () => {
    cognitoMock.on(ListUserPoolClientsCommand).rejects(
      new InternalErrorException({
        message: 'Something went wrong.',
        $metadata: {}
      })
    )

    const response = await server.inject({
      method: 'GET',
      url: `/clients/${userPoolId}`,
      auth
    })

    expect(response.statusCode).toBe(500)
  })

  test('Should return 401 without credentials', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/clients/${userPoolId}`
    })

    expect(response.statusCode).toBe(401)
  })
})

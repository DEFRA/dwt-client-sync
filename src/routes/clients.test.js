import * as clientService from '#/services/clients.js'
import { clients } from './clients.js'

describe('Client Routes', () => {
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

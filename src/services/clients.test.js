import { findClient } from './clients.js'

describe('#findClient', () => {
  const userPoolId = 123
  const clientId = 456

  const dbFindFn = vi.fn()
  const clientRecord = {
    UserPoolClient: {
      UserPoolId: userPoolId,
      ClientName: 'Test Client',
      ClientId: clientId,
      LastModifiedDate: '2026-07-10T08:41:31.618Z',
      CreationDate: '2026-05-19T08:25:53.785Z'
    }
  }

  const db = {
    collection: () => ({
      findOne: dbFindFn
        .mockReturnValueOnce(clientRecord)
        .mockReturnValueOnce(undefined)
    })
  }

  it('should return a client record when client is found', () => {
    const result = findClient(userPoolId, clientId, db)

    expect(dbFindFn).toHaveBeenCalledWith({
      UserPoolId: userPoolId,
      ClientId: clientId
    })
    expect(result).toEqual(clientRecord)
  })

  it('should return an empty object when client is not found', () => {
    const result = findClient(userPoolId, clientId, db)

    expect(dbFindFn).toHaveBeenCalledWith({
      UserPoolId: userPoolId,
      ClientId: clientId
    })
    expect(result).toBeUndefined()
  })
})

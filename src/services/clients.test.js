import { findClient } from './clients.js'

describe('#findClient', () => {
  const dbFindFn = vi.fn()
  const clientRecord = {
    clientName: 'Test Client',
    clientId: '1a2b3c4d5e6f7g8h9i0j1k2l3m',
    tenantServiceName: 'waste-movement-external-api'
  }

  const db = {
    collection: () => ({
      findOne: dbFindFn
        .mockReturnValueOnce(clientRecord)
        .mockReturnValueOnce(undefined)
    })
  }

  it('should return a client record when client is found', () => {
    const result = findClient(
      clientRecord.tenantServiceName,
      clientRecord.clientId,
      db
    )

    expect(dbFindFn).toHaveBeenCalledWith(
      {
        tenantServiceName: clientRecord.tenantServiceName,
        clientId: clientRecord.clientId
      },
      { projection: { _id: 0 } }
    )
    expect(result).toEqual(clientRecord)
  })

  it('should return an empty object when client is not found', () => {
    const result = findClient(
      clientRecord.tenantServiceName,
      clientRecord.clientId,
      db
    )

    expect(dbFindFn).toHaveBeenCalledWith(
      {
        tenantServiceName: clientRecord.tenantServiceName,
        clientId: clientRecord.clientId
      },
      { projection: { _id: 0 } }
    )
    expect(result).toBeUndefined()
  })
})

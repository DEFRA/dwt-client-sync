import { findClient, store } from './clients.js'

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
describe('#store', () => {
  const tenantServiceName = 'waste-movement-external-api'

  let mockToArray
  let mockFind
  let mockBulkWrite
  let mockCollection
  let db
  let logger

  beforeEach(() => {
    mockToArray = vi.fn()
    mockFind = vi.fn(() => ({ toArray: mockToArray }))
    mockBulkWrite = vi.fn()
    mockCollection = vi.fn(() => ({
      find: mockFind,
      bulkWrite: mockBulkWrite
    }))
    db = { collection: mockCollection }
    logger = {
      info: vi.fn(),
      error: vi.fn()
    }
  })

  it('fetches existing clients scoped to the tenant service, excluding _id', async () => {
    mockToArray.mockResolvedValue([])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 0,
      modifiedCount: 0,
      deletedCount: 0
    })

    await store(logger, db, [], tenantServiceName)

    expect(mockFind).toHaveBeenCalledWith(
      { tenantServiceName },
      { projection: { _id: 0 } }
    )
  })

  it('inserts a client that does not exist yet', async () => {
    mockToArray.mockResolvedValue([])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 1,
      modifiedCount: 0,
      deletedCount: 0
    })

    const incomingClients = [{ clientId: 'client-1', clientName: 'Client One' }]

    const result = await store(logger, db, incomingClients, tenantServiceName)

    expect(mockBulkWrite).toHaveBeenCalledWith(
      [
        {
          insertOne: {
            document: { clientId: 'client-1', clientName: 'Client One' }
          }
        }
      ],
      { ordered: false }
    )
    expect(result).toEqual({
      insertedCount: 1,
      modifiedCount: 0,
      deletedCount: 0
    })
  })

  it('updates a client whose fields have changed', async () => {
    mockToArray.mockResolvedValue([
      { clientId: 'client-1', clientName: 'Old Name' }
    ])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 0,
      modifiedCount: 1,
      deletedCount: 0
    })

    const incomingClients = [{ clientId: 'client-1', clientName: 'New Name' }]

    await store(logger, db, incomingClients, tenantServiceName)

    expect(mockBulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { clientId: 'client-1', tenantServiceName },
            update: { $set: { clientId: 'client-1', clientName: 'New Name' } }
          }
        }
      ],
      { ordered: false }
    )
  })

  it('skips a client whose fields are unchanged', async () => {
    const unchangedClient = { clientId: 'client-1', clientName: 'Same Name' }

    mockToArray.mockResolvedValue([unchangedClient])

    const incomingClients = [{ ...unchangedClient }]

    const result = await store(logger, db, incomingClients, tenantServiceName)

    expect(mockBulkWrite).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('No changes to sync')
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 })
  })

  it('deletes a client that is missing from the incoming list', async () => {
    mockToArray.mockResolvedValue([
      { clientId: 'client-1', clientName: 'Client One' }
    ])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 0,
      modifiedCount: 0,
      deletedCount: 1
    })

    const result = await store(logger, db, [], tenantServiceName)

    expect(mockBulkWrite).toHaveBeenCalledWith(
      [
        {
          deleteOne: {
            filter: { clientId: 'client-1', tenantServiceName }
          }
        }
      ],
      { ordered: false }
    )
    expect(result).toEqual({
      insertedCount: 0,
      modifiedCount: 0,
      deletedCount: 1
    })
  })

  it('handles a mix of inserts, updates, and deletes in one call', async () => {
    mockToArray.mockResolvedValue([
      { clientId: 'client-1', clientName: 'Unchanged' },
      { clientId: 'client-2', clientName: 'Old Name' },
      { clientId: 'client-3', clientName: 'To Be Deleted' }
    ])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 1,
      modifiedCount: 1,
      deletedCount: 1
    })

    const incomingClients = [
      { clientId: 'client-1', clientName: 'Unchanged' },
      { clientId: 'client-2', clientName: 'New Name' },
      { clientId: 'client-4', clientName: 'Brand New' }
    ]

    await store(logger, db, incomingClients, tenantServiceName)

    expect(mockBulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          updateOne: {
            filter: { clientId: 'client-2', tenantServiceName },
            update: { $set: { clientId: 'client-2', clientName: 'New Name' } }
          }
        },
        {
          insertOne: {
            document: { clientId: 'client-4', clientName: 'Brand New' }
          }
        },
        {
          deleteOne: {
            filter: { clientId: 'client-3', tenantServiceName }
          }
        }
      ]),
      { ordered: false }
    )

    const [operations] = mockBulkWrite.mock.calls[0]
    expect(operations).toHaveLength(3)
  })

  it('returns a zero-count result and logs when there are no changes', async () => {
    mockToArray.mockResolvedValue([])

    const result = await store(logger, db, [], tenantServiceName)

    expect(mockBulkWrite).not.toHaveBeenCalled()
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 })
    expect(logger.info).toHaveBeenCalledWith('No changes to sync')
  })

  it('logs the bulkWrite summary on success', async () => {
    mockToArray.mockResolvedValue([])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 2,
      modifiedCount: 1,
      deletedCount: 0
    })

    const incomingClients = [
      { clientId: 'client-1', clientName: 'One' },
      { clientId: 'client-2', clientName: 'Two' }
    ]

    await store(logger, db, incomingClients, tenantServiceName)

    expect(logger.info).toHaveBeenCalledWith(
      'Sync completed: 2 inserted, 1 updated, 0 deleted'
    )
  })

  it('logs and rethrows when fetching existing clients fails', async () => {
    const fetchError = new Error('Connection lost')
    mockToArray.mockRejectedValue(fetchError)

    await expect(store(logger, db, [], tenantServiceName)).rejects.toThrow(
      'Connection lost'
    )

    expect(logger.error).toHaveBeenCalledWith(
      `Failed to fetch existing clients for ${tenantServiceName} with error ${fetchError}`
    )
    expect(mockBulkWrite).not.toHaveBeenCalled()
  })

  it('logs and rethrows when bulkWrite fails', async () => {
    mockToArray.mockResolvedValue([])

    const bulkWriteError = new Error('Duplicate key')
    bulkWriteError.writeErrors = ['some write error']
    bulkWriteError.result = { insertedCount: 0 }
    mockBulkWrite.mockRejectedValue(bulkWriteError)

    const incomingClients = [{ clientId: 'client-1', clientName: 'Client One' }]

    await expect(
      store(logger, db, incomingClients, tenantServiceName)
    ).rejects.toThrow('Duplicate key')

    expect(logger.error).toHaveBeenCalledWith(
      `Sync partially or fully failed for ${tenantServiceName} with error ${bulkWriteError}, writeErrors: ${bulkWriteError.writeErrors}, result: ${bulkWriteError.result}`
    )
  })

  it('treats clients with different field values as changed even with matching clientId', async () => {
    mockToArray.mockResolvedValue([
      { clientId: 'client-1', clientName: 'A', extraField: 'x' }
    ])
    mockBulkWrite.mockResolvedValue({
      insertedCount: 0,
      modifiedCount: 1,
      deletedCount: 0
    })

    const incomingClients = [
      { clientId: 'client-1', clientName: 'A', extraField: 'y' }
    ]

    await store(logger, db, incomingClients, tenantServiceName)

    expect(mockBulkWrite).toHaveBeenCalledWith(
      [
        {
          updateOne: {
            filter: { clientId: 'client-1', tenantServiceName },
            update: {
              $set: { clientId: 'client-1', clientName: 'A', extraField: 'y' }
            }
          }
        }
      ],
      { ordered: false }
    )
  })
})

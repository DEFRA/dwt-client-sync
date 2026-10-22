import { findClient, readStoredClients, saveClient, store } from './clients.js'

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

  let mockBulkWrite
  let mockCollection
  let db
  let logger

  beforeEach(() => {
    mockBulkWrite = vi.fn()
    mockCollection = vi.fn(() => ({
      bulkWrite: mockBulkWrite
    }))
    db = { collection: mockCollection }
    logger = {
      info: vi.fn(),
      error: vi.fn()
    }
  })

  it('upserts a client that is not stored yet, in case create has saved it since', async () => {
    const existing = []
    mockBulkWrite.mockResolvedValue({
      insertedCount: 1,
      modifiedCount: 0,
      deletedCount: 0
    })

    const incomingClients = [{ clientId: 'client-1', clientName: 'Client One' }]

    const result = await store(
      logger,
      db,
      incomingClients,
      tenantServiceName,
      existing
    )

    expect(mockBulkWrite).toHaveBeenCalledWith(
      [
        {
          replaceOne: {
            filter: { clientId: 'client-1', tenantServiceName },
            replacement: { clientId: 'client-1', clientName: 'Client One' },
            upsert: true
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
    const existing = [{ clientId: 'client-1', clientName: 'Old Name' }]
    mockBulkWrite.mockResolvedValue({
      insertedCount: 0,
      modifiedCount: 1,
      deletedCount: 0
    })

    const incomingClients = [{ clientId: 'client-1', clientName: 'New Name' }]

    await store(logger, db, incomingClients, tenantServiceName, existing)

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

    const existing = [unchangedClient]

    const incomingClients = [{ ...unchangedClient }]

    const result = await store(
      logger,
      db,
      incomingClients,
      tenantServiceName,
      existing
    )

    expect(mockBulkWrite).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith('No changes to sync')
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 })
  })

  it('deletes a client that is missing from the incoming list', async () => {
    const existing = [{ clientId: 'client-1', clientName: 'Client One' }]
    mockBulkWrite.mockResolvedValue({
      insertedCount: 0,
      modifiedCount: 0,
      deletedCount: 1
    })

    const result = await store(logger, db, [], tenantServiceName, existing)

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
    const existing = [
      { clientId: 'client-1', clientName: 'Unchanged' },
      { clientId: 'client-2', clientName: 'Old Name' },
      { clientId: 'client-3', clientName: 'To Be Deleted' }
    ]
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

    await store(logger, db, incomingClients, tenantServiceName, existing)

    expect(mockBulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          updateOne: {
            filter: { clientId: 'client-2', tenantServiceName },
            update: { $set: { clientId: 'client-2', clientName: 'New Name' } }
          }
        },
        {
          replaceOne: {
            filter: { clientId: 'client-4', tenantServiceName },
            replacement: { clientId: 'client-4', clientName: 'Brand New' },
            upsert: true
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
    const existing = []

    const result = await store(logger, db, [], tenantServiceName, existing)

    expect(mockBulkWrite).not.toHaveBeenCalled()
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 })
    expect(logger.info).toHaveBeenCalledWith('No changes to sync')
  })

  it('logs the bulkWrite summary on success', async () => {
    const existing = []
    mockBulkWrite.mockResolvedValue({
      upsertedCount: 2,
      modifiedCount: 0,
      deletedCount: 0
    })

    const incomingClients = [
      { clientId: 'client-1', clientName: 'One' },
      { clientId: 'client-2', clientName: 'Two' }
    ]

    await store(logger, db, incomingClients, tenantServiceName, existing)

    expect(logger.info).toHaveBeenCalledWith(
      'Sync completed: 2 inserted, 0 updated, 0 deleted'
    )
  })

  it('logs and rethrows when bulkWrite fails', async () => {
    const existing = []

    const bulkWriteError = new Error('Duplicate key')
    bulkWriteError.writeErrors = ['some write error']
    bulkWriteError.result = { insertedCount: 0 }
    mockBulkWrite.mockRejectedValue(bulkWriteError)

    const incomingClients = [{ clientId: 'client-1', clientName: 'Client One' }]

    await expect(
      store(logger, db, incomingClients, tenantServiceName, existing)
    ).rejects.toThrow('Duplicate key')

    expect(logger.error).toHaveBeenCalledWith(
      `Sync partially or fully failed for ${tenantServiceName} with error ${bulkWriteError}, writeErrors: ${bulkWriteError.writeErrors}, result: ${bulkWriteError.result}`
    )
  })
})

describe('#readStoredClients', () => {
  const tenantServiceName = 'waste-movement-external-api'
  const logger = { error: vi.fn() }

  it('reads the clients scoped to the tenant service, excluding _id', async () => {
    const stored = [{ clientId: 'client-1', clientName: 'One' }]
    const toArray = vi.fn().mockResolvedValue(stored)
    const find = vi.fn(() => ({ toArray }))
    const db = { collection: () => ({ find }) }

    const result = await readStoredClients(logger, db, tenantServiceName)

    expect(find).toHaveBeenCalledWith(
      { tenantServiceName },
      { projection: { _id: 0 } }
    )
    expect(result).toBe(stored)
  })

  it('logs and rethrows when reading fails', async () => {
    const fetchError = new Error('Connection lost')
    const db = {
      collection: () => ({
        find: () => ({ toArray: vi.fn().mockRejectedValue(fetchError) })
      })
    }

    await expect(
      readStoredClients(logger, db, tenantServiceName)
    ).rejects.toThrow('Connection lost')
    expect(logger.error).toHaveBeenCalledWith(
      `Failed to fetch existing clients for ${tenantServiceName} with error ${fetchError}`
    )
  })
})

describe('#saveClient', () => {
  it('replaces any stored client with the same id, or inserts it', async () => {
    const replaceOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    const db = { collection: vi.fn(() => ({ replaceOne })) }
    const record = {
      clientId: 'my_client_id',
      clientName: 'Test Client',
      tenantServiceName: 'waste-movement-external-api'
    }

    await saveClient(db, record)

    expect(replaceOne).toHaveBeenCalledWith(
      {
        tenantServiceName: 'waste-movement-external-api',
        clientId: 'my_client_id'
      },
      record,
      { upsert: true }
    )
  })

  it('passes on a failed write', async () => {
    const err = new Error('Mongo down')
    const db = {
      collection: () => ({ replaceOne: vi.fn().mockRejectedValue(err) })
    }

    await expect(
      saveClient(db, { clientId: 'id', tenantServiceName: 'service' })
    ).rejects.toBe(err)
  })
})

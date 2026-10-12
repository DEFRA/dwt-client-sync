import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    get: vi.fn()
  }
}))

let loggerMock

vi.mock('#/common/helpers/logging/logger.js', () => {
  loggerMock = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
  return {
    createLogger: vi.fn(() => loggerMock)
  }
})

vi.mock('#/config.js', () => ({
  config: mockConfig
}))
mockConfig.get.mockReturnValue('test-collection')
const { deleteClient } = await import('./client-delete.js')

describe('deleteClient', () => {
  let mockDb

  beforeEach(() => {
    vi.clearAllMocks()

    mockConfig.get.mockReturnValue('test-collection')

    mockDb = {
      collection: vi.fn().mockReturnThis(),
      deleteOne: vi.fn()
    }
  })

  it('successfully deletes a client', async () => {
    mockDb.deleteOne.mockResolvedValue({ deletedCount: 1 })

    const result = await deleteClient(mockDb, 'client-1', 'service-one')

    expect(result).toEqual({ deletedCount: 1 })
    expect(mockDb.collection).toHaveBeenCalledWith('test-collection')
    expect(mockDb.deleteOne).toHaveBeenCalledWith({
      clientId: 'client-1',
      tenantServiceName: 'service-one'
    })
  })

  it('logs a warning when no client is found', async () => {
    mockDb.deleteOne.mockResolvedValue({ deletedCount: 0 })

    const result = await deleteClient(mockDb, 'non-existent', 'service-one')

    expect(result).toEqual({ deletedCount: 0 })
    expect(loggerMock.warn).toHaveBeenCalled()
  })

  it('throws an error when database operation fails', async () => {
    mockDb.deleteOne.mockRejectedValue(new Error('DB Error'))

    await expect(
      deleteClient(mockDb, 'client-1', 'service-one')
    ).rejects.toThrow('DB Error')
  })
})

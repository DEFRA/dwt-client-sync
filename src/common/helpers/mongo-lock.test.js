import { acquireLock, releaseLock, requireLock } from './mongo-lock.js'

describe('Lock Functions', () => {
  let locker
  let logger

  beforeEach(() => {
    locker = {
      lock: vi.fn()
    }
    logger = {
      error: vi.fn(),
      info: vi.fn()
    }
  })

  describe('acquireLock', () => {
    test('should acquire lock and return it', async () => {
      const resource = 'testResource'
      const mockLock = { id: 'lockId' }

      locker.lock.mockResolvedValue(mockLock) // Mocking lock method to resolve a lock

      const result = await acquireLock(locker, resource, logger)

      expect(result).toEqual(mockLock)
      expect(logger.error).not.toHaveBeenCalled()
      expect(locker.lock).toHaveBeenCalledWith(resource)
    })

    test('should log error and return null if lock cannot be acquired', async () => {
      const resource = 'testResource'

      locker.lock.mockResolvedValue(null) // Mocking lock method to resolve to null

      const result = await acquireLock(locker, resource, logger)

      expect(result).toBeNull()
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to acquire lock for ${resource}`
      )
      expect(locker.lock).toHaveBeenCalledWith(resource)
    })
  })

  describe('requireLock', () => {
    test('should acquire lock and return it', async () => {
      const resource = 'testResource'
      const mockLock = { id: 'lockId' }

      locker.lock.mockResolvedValue(mockLock) // Mocking lock method to resolve a lock

      const result = await requireLock(locker, resource)

      expect(result).toEqual(mockLock)
      expect(locker.lock).toHaveBeenCalledWith(resource)
    })

    test('should throw error if lock cannot be acquired', async () => {
      const resource = 'testResource'

      locker.lock.mockResolvedValue(null) // Mocking lock method to resolve to null

      await expect(requireLock(locker, resource)).rejects.toThrow(
        `Failed to acquire lock for ${resource}`
      )
      expect(locker.lock).toHaveBeenCalledWith(resource)
    })

    describe('releaseLock', () => {
      test('should release lock', async () => {
        const mockLock = { id: 'lockId', free: vi.fn() }

        await releaseLock(mockLock, logger)

        expect(mockLock.free).toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith(`Releasing lock`)
      })

      test('releaseLock throws an error', async () => {
        const mockLock = { id: 'lockId', free: vi.fn() }

        mockLock.free = vi.fn().mockImplementation(() => {
          throw new Error('Error happened while releasing lock')
        })

        await releaseLock(mockLock, logger)

        expect(mockLock.free).toHaveBeenCalled()
        expect(logger.error).toHaveBeenCalledWith(
          `Error happened while releasing lock, Failed to release lock`
        )
      })
      test('releaseLock no lock', async () => {
        await releaseLock(undefined, logger)
      })
    })
  })
})

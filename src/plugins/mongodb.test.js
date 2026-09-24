import { Db, MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

describe('#mongoDb', () => {
  let server

  describe('Set up', () => {
    beforeAll(async () => {
      // Dynamic import needed due to config being updated by vitest-mongodb
      const { createServer } = await import('#/server.js')

      server = await createServer()
      await server.initialize()
    })

    test('Server should have expected MongoDb decorators', () => {
      expect(server.db).toBeInstanceOf(Db)
      expect(server.mongoClient).toBeInstanceOf(MongoClient)
      expect(server.locker).toBeInstanceOf(LockManager)
    })

    test('MongoDb should have expected database name', () => {
      expect(server.db.databaseName).toBe('dwt-client-sync')
    })

    test('MongoDb should have expected namespace', () => {
      expect(server.db.namespace).toBe('dwt-client-sync')
    })
  })

  describe('Shut down', () => {
    beforeAll(async () => {
      // Dynamic import needed due to config being updated by vitest-mongodb
      const { createServer } = await import('#/server.js')

      server = await createServer()
      await server.initialize()
    })

    test('Should close Mongo client on server stop', async () => {
      const closeSpy = vi.spyOn(server.mongoClient, 'close')
      await server.stop({ timeout: 1000 })

      expect(closeSpy).toHaveBeenCalledWith(true)
    })

    test('Should log and not throw when closing Mongo client fails', async () => {
      const closeError = new Error('Connection already terminated')

      vi.spyOn(server.mongoClient, 'close').mockRejectedValue(closeError)
      const loggerErrorSpy = vi.spyOn(server.logger, 'error')

      await expect(server.stop({ timeout: 1000 })).resolves.not.toThrow()

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        closeError,
        'failed to close mongo client'
      )
    })
  })
})

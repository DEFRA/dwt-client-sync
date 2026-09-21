import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Db, MongoClient } from 'mongodb'
import { LockManager } from 'mongo-locks'

const { mockSchedule, mockSync, mockCreateLogger, mockConfigGet } = vi.hoisted(
  () => ({
    mockSchedule: vi.fn(),
    mockSync: vi.fn(),
    mockCreateLogger: vi.fn(),
    mockConfigGet: vi.fn()
  })
)

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule
  }
}))

vi.mock('#/services/client-sync.js', () => ({
  sync: mockSync
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: mockCreateLogger
}))

vi.mock('#/config.js', () => ({
  config: {
    get: mockConfigGet
  }
}))

describe('scheduledClientSync', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockCreateLogger.mockReturnValue(mockLogger)

    mockConfigGet.mockReturnValue({
      syncSchedule: '0 * * * *'
    })

    mockSync.mockResolvedValue({
      totalServicesProcessed: 2,
      services: []
    })
  })

  it('registers the scheduled client sync cron job', async () => {
    const { scheduledClientSync } = await import('./scheduled-client-sync.js')

    scheduledClientSync.plugin.register()

    expect(mockConfigGet).toHaveBeenCalledWith('cognito')

    expect(mockSchedule).toHaveBeenCalledWith(
      '0 * * * *',
      expect.any(Function),
      {
        noOverlap: true,
        name: 'client-sync-schedule'
      }
    )
  })

  it('calls sync and logs results when the cron callback runs', async () => {
    const { scheduledClientSync } = await import('./scheduled-client-sync.js')

    scheduledClientSync.plugin.register()

    const scheduledCallback = mockSchedule.mock.calls[0][1]

    await scheduledCallback()

    expect(mockSync).toHaveBeenCalledOnce()

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Scheduled client sync starting'
    )

    expect(mockLogger.info).toHaveBeenCalledWith({
      totalServicesProcessed: 2,
      services: []
    })

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Scheduled client sync finished'
    )
  })

  it('passes the configured schedule to cron', async () => {
    mockConfigGet.mockReturnValue({
      syncSchedule: '*/10 * * * *'
    })

    const { scheduledClientSync } = await import('./scheduled-client-sync.js')

    scheduledClientSync.plugin.register()

    expect(mockSchedule.mock.calls[0][0]).toBe('*/10 * * * *')
  })
})

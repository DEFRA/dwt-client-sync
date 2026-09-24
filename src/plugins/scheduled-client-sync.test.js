import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn()
  }
}))

vi.mock('#/services/client-sync.js', () => ({
  sync: vi.fn()
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: vi.fn()
}))

vi.mock('#/config.js', () => ({
  config: {
    get: vi.fn()
  }
}))

describe('scheduledClientSync', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn()
  }

  const mockServer = {
    db: {},
    logger: mockLogger
  }

  let cron
  let sync
  let createLogger
  let config

  beforeEach(async () => {
    vi.clearAllMocks()

    cron = (await import('node-cron')).default
    sync = (await import('#/services/client-sync.js')).sync
    createLogger = (await import('#/common/helpers/logging/logger.js'))
      .createLogger
    config = (await import('#/config.js')).config

    createLogger.mockReturnValue(mockLogger)

    config.get.mockReturnValue({
      syncSchedule: '0 * * * *'
    })

    sync.mockResolvedValue({
      totalServicesProcessed: 2,
      services: []
    })
  })

  it('registers the scheduled client sync cron job', async () => {
    const { scheduledClientSync } = await import('./scheduled-client-sync.js')

    scheduledClientSync.plugin.register(mockServer)

    expect(config.get).toHaveBeenCalledWith('cognito')

    expect(cron.schedule).toHaveBeenCalledWith(
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

    scheduledClientSync.plugin.register(mockServer)

    const scheduledCallback = cron.schedule.mock.calls[0][1]

    await scheduledCallback()

    expect(sync).toHaveBeenCalledOnce()

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
    config.get.mockReturnValue({
      syncSchedule: '*/10 * * * *'
    })

    const { scheduledClientSync } = await import('./scheduled-client-sync.js')

    scheduledClientSync.plugin.register(mockServer)

    expect(cron.schedule.mock.calls[0][0]).toBe('*/10 * * * *')
  })
})

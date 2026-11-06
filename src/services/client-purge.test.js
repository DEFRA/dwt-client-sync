import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('#/common/helpers/cognito-client.js', () => ({
  purgeCognitoCredential: vi.fn()
}))

const { purgeCognitoCredential } =
  await import('#/common/helpers/cognito-client.js')
const { PurgeOutcome } = await import('#/domain/client-secrets.js')
const { purgeOldSecret } = await import('./client-purge.js')

const tenantServiceName = 'waste-movement-external-api'
const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test_Client' }

describe('purgeOldSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    purgeCognitoCredential.mockResolvedValue([client])
  })

  it('purges by name, without a cutoff', async () => {
    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.PURGED)
    expect(purgeCognitoCredential).toHaveBeenCalledWith(
      tenantServiceName,
      'Test_Client'
    )
  })

  it("returns and logs the outcome of CDP's response", async () => {
    purgeCognitoCredential.mockResolvedValue([])

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.NOT_IN_CDP)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Purging client ${clientId}: not in CDP`
    )
  })

  it('logs an error when CDP also purges other clients with the name', async () => {
    purgeCognitoCredential.mockResolvedValue([
      { clientId: 'other_client_id', clientName: 'Test_Client' },
      client
    ])

    const outcome = await purgeOldSecret(tenantServiceName, client)

    expect(outcome).toBe(PurgeOutcome.PURGED)
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Purging client ${clientId} also purged 1 other client(s) with the same name`
    )
  })

  it('logs a successful purge', async () => {
    await purgeOldSecret(tenantServiceName, client)

    expect(mockLogger.info).toHaveBeenCalledWith(
      `Purged old client secrets for client ${clientId} of ${tenantServiceName}`
    )
  })

  it('passes on an error from the purge request', async () => {
    const err = new Error('Failed')
    purgeCognitoCredential.mockRejectedValue(err)

    await expect(purgeOldSecret(tenantServiceName, client)).rejects.toBe(err)
  })
})

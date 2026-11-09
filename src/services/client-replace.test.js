import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const { MockCdpError } = vi.hoisted(() => ({
  MockCdpError: class extends Error {
    constructor(message, { outcomeUnknown }) {
      super(message)
      this.outcomeUnknown = outcomeUnknown
    }
  }
}))

vi.mock('#/common/helpers/cognito-client.js', () => ({
  CdpError: MockCdpError
}))

vi.mock('#/services/client-directory.js', () => ({
  listClients: vi.fn()
}))

vi.mock('#/services/client-rotate.js', () => ({
  rotateSecret: vi.fn()
}))

vi.mock('#/services/client-purge.js', () => ({
  purgeOldSecret: vi.fn()
}))

const { listClients } = await import('#/services/client-directory.js')
const { rotateSecret } = await import('#/services/client-rotate.js')
const { purgeOldSecret } = await import('#/services/client-purge.js')
const { PurgeOutcome, ReplaceOutcome, RotateOutcome } =
  await import('#/domain/client-secrets.js')
const { replaceSecret } = await import('./client-replace.js')

const tenantServiceName = 'waste-movement-external-api'
const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test_Client' }
const otherClient = { clientId: 'other_client_id', clientName: 'Other_Client' }
const rotatedClient = { ...client, clientSecret: 'new_secret' }

describe('replaceSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClients.mockResolvedValue([client, otherClient])
    rotateSecret.mockResolvedValue({
      outcome: RotateOutcome.ROTATED,
      rotatedClient
    })
    purgeOldSecret.mockResolvedValue(PurgeOutcome.PURGED)
  })

  it('rotates and then purges, returning the client with its new secret', async () => {
    const result = await replaceSecret(tenantServiceName, client)

    expect(result).toStrictEqual({
      outcome: ReplaceOutcome.REPLACED,
      rotatedClient
    })
    expect(rotateSecret).toHaveBeenCalledWith(tenantServiceName, client)
    expect(purgeOldSecret).toHaveBeenCalledWith(tenantServiceName, client)
    expect(rotateSecret.mock.invocationCallOrder[0]).toBeLessThan(
      purgeOldSecret.mock.invocationCallOrder[0]
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Replaced client secret for client ${clientId} of ${tenantServiceName}`
    )
  })

  it('changes nothing when another client has exactly the same name', async () => {
    listClients.mockResolvedValue([
      client,
      { ...otherClient, clientName: 'Test_Client' }
    ])

    const result = await replaceSecret(tenantServiceName, client)

    expect(result).toStrictEqual({ outcome: ReplaceOutcome.NAME_SHARED })
    expect(rotateSecret).not.toHaveBeenCalled()
    expect(purgeOldSecret).not.toHaveBeenCalled()
  })

  it.each([
    RotateOutcome.NOT_IN_CDP,
    RotateOutcome.NAME_REUSED,
    RotateOutcome.OUTCOME_UNKNOWN
  ])(
    "returns the outcome without purging when the rotate's outcome is '%s'",
    async (outcome) => {
      rotateSecret.mockResolvedValue({ outcome })

      const result = await replaceSecret(tenantServiceName, client)

      expect(result).toStrictEqual({ outcome })
      expect(purgeOldSecret).not.toHaveBeenCalled()
    }
  )

  it('passes on an error from the rotate request, without purging', async () => {
    const err = new Error('Failed')
    rotateSecret.mockRejectedValue(err)

    await expect(replaceSecret(tenantServiceName, client)).rejects.toBe(err)
    expect(purgeOldSecret).not.toHaveBeenCalled()
  })

  it.each([
    [PurgeOutcome.NOT_IN_CDP, ReplaceOutcome.OLD_SECRET_KEPT],
    [PurgeOutcome.NAME_SHARED, ReplaceOutcome.OLD_SECRET_KEPT],
    [PurgeOutcome.NAME_REUSED, ReplaceOutcome.OLD_SECRET_KEPT],
    [PurgeOutcome.OUTCOME_UNKNOWN, ReplaceOutcome.PURGE_OUTCOME_UNKNOWN]
  ])(
    "keeps the new secret when the purge's outcome is '%s'",
    async (purgeOutcome, outcome) => {
      purgeOldSecret.mockResolvedValue(purgeOutcome)

      const result = await replaceSecret(tenantServiceName, client)

      expect(result).toStrictEqual({ outcome, rotatedClient })
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Replacing client ${clientId}: ${outcome}`
      )
    }
  )

  it.each([
    [
      'CDP refuses',
      new MockCdpError('Refused', { outcomeUnknown: false }),
      ReplaceOutcome.OLD_SECRET_KEPT
    ],
    [
      "CDP's outcome is unknown",
      new MockCdpError('Timed out', { outcomeUnknown: true }),
      ReplaceOutcome.PURGE_OUTCOME_UNKNOWN
    ],
    [
      'something else fails',
      new Error('Directory down'),
      ReplaceOutcome.OLD_SECRET_KEPT
    ],
    [
      'something other than CDP fails, however it is marked',
      Object.assign(new Error('Directory down'), { outcomeUnknown: true }),
      ReplaceOutcome.OLD_SECRET_KEPT
    ]
  ])(
    'keeps the new secret when the purge request fails because %s',
    async (_, err, outcome) => {
      purgeOldSecret.mockRejectedValue(err)

      const result = await replaceSecret(tenantServiceName, client)

      expect(result).toStrictEqual({ outcome, rotatedClient })
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Purging client ${clientId} failed: ${err.message}`
      )
    }
  )

  it('passes on an error from listing the clients, without rotating', async () => {
    const err = new Error('Failed')
    listClients.mockRejectedValue(err)

    await expect(replaceSecret(tenantServiceName, client)).rejects.toBe(err)
    expect(rotateSecret).not.toHaveBeenCalled()
  })
})

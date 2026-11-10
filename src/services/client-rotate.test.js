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
  rotateCognitoCredential: vi.fn(),
  getCognitoCredential: vi.fn()
}))

vi.mock('#/services/clients.js', () => ({
  saveClient: vi.fn()
}))

const { rotateCognitoCredential, getCognitoCredential } =
  await import('#/common/helpers/cognito-client.js')
const { saveClient } = await import('#/services/clients.js')
const { RotateOutcome } = await import('#/domain/client-secrets.js')
const { rotateSecret, saveRotatedClient } = await import('./client-rotate.js')

const tenantServiceName = 'waste-movement-external-api'
const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test_Client' }
const rotatedClient = { ...client, clientSecret: 'new_secret' }

describe('rotateSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rotateCognitoCredential.mockResolvedValue([rotatedClient])
  })

  it('rotates by name and returns the client with its new secret', async () => {
    const result = await rotateSecret(tenantServiceName, client)

    expect(result).toStrictEqual({
      outcome: RotateOutcome.ROTATED,
      rotatedClient
    })
    expect(rotateCognitoCredential).toHaveBeenCalledWith(
      tenantServiceName,
      'Test_Client'
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      `Rotated client secret for client ${clientId} of ${tenantServiceName}`
    )
  })

  it("returns and logs the outcome when CDP didn't rotate the client", async () => {
    rotateCognitoCredential.mockResolvedValue([])

    const result = await rotateSecret(tenantServiceName, client)

    expect(result).toStrictEqual({
      outcome: RotateOutcome.NOT_IN_CDP,
      rotatedClient: undefined
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      `Rotating client ${clientId}: not in CDP`
    )
  })

  it('warns when CDP also rotates other clients with the name', async () => {
    rotateCognitoCredential.mockResolvedValue([
      { clientId: 'other_client_id', clientName: 'Test_Client' },
      rotatedClient
    ])

    await rotateSecret(tenantServiceName, client)

    expect(mockLogger.warn).toHaveBeenCalledWith(
      `Rotating client ${clientId} also rotated 1 other client(s) with the same name`
    )
  })

  it('passes on an error from the rotate request', async () => {
    const err = new Error('Failed')
    rotateCognitoCredential.mockRejectedValue(err)

    await expect(rotateSecret(tenantServiceName, client)).rejects.toBe(err)
  })
})

describe('saveRotatedClient', () => {
  const db = {}
  const secrets = [{ id: 'secret_id', createdAt: '2026-11-09T12:00:00Z' }]

  beforeEach(() => {
    vi.clearAllMocks()
    getCognitoCredential.mockResolvedValue({ ...rotatedClient, secrets })
  })

  it('saves the client with its secret metadata, without the secret', async () => {
    await saveRotatedClient(db, tenantServiceName, rotatedClient)

    expect(saveClient).toHaveBeenCalledWith(db, {
      clientId,
      clientName: 'Test_Client',
      tenantServiceName,
      secrets
    })
  })

  it('logs, without saving, when fetching the secret metadata fails', async () => {
    getCognitoCredential.mockRejectedValue(new Error('CDP down'))

    await saveRotatedClient(db, tenantServiceName, rotatedClient)

    expect(saveClient).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to fetch credential metadata: CDP down'
    )
  })

  it('logs when saving fails', async () => {
    saveClient.mockRejectedValue(new Error('Mongo down'))

    await saveRotatedClient(db, tenantServiceName, rotatedClient)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Saving rotated client failed: Mongo down'
    )
  })
})

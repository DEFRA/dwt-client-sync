import { describe, it, expect } from 'vitest'
import {
  PurgeOutcome,
  purgeResult,
  RotateOutcome,
  rotateResult,
  ReplaceOutcome,
  isRotateOutcome
} from './client-secrets.js'

const clientId = 'my_client_id'
const client = { clientId, clientName: 'Test_Client' }

describe('purgeResult', () => {
  const other = { clientId: 'other_client_id', clientName: 'Test_Client' }

  it.each([
    ['this client purged', [client], PurgeOutcome.PURGED, 0],
    ['others purged too', [other, client], PurgeOutcome.PURGED, 1],
    ['the client skipped', [], PurgeOutcome.NOT_IN_CDP, 0],
    ['only another client purged', [other], PurgeOutcome.NAME_REUSED, 1],
    ['no client details', undefined, PurgeOutcome.OUTCOME_UNKNOWN, 0]
  ])(
    'reads a response with %s',
    (_, purgedClients, outcome, otherClientsPurged) => {
      expect(purgeResult(purgedClients, clientId)).toStrictEqual({
        outcome,
        otherClientsPurged
      })
    }
  )
})

describe('rotateResult', () => {
  const rotated = { ...client, clientSecret: 'new_secret' }
  const other = {
    clientId: 'other_client_id',
    clientName: 'Test_Client',
    clientSecret: 'other_secret'
  }

  it.each([
    ['this client rotated', [rotated], RotateOutcome.ROTATED, rotated, 0],
    ['others rotated too', [other, rotated], RotateOutcome.ROTATED, rotated, 1],
    ['the client skipped', [], RotateOutcome.NOT_IN_CDP, undefined, 0],
    [
      'only another client rotated',
      [other],
      RotateOutcome.NAME_REUSED,
      undefined,
      1
    ],
    [
      'no client details',
      undefined,
      RotateOutcome.OUTCOME_UNKNOWN,
      undefined,
      0
    ]
  ])(
    'reads a response with %s',
    (_, rotatedClients, outcome, rotatedClient, otherClientsRotated) => {
      expect(rotateResult(rotatedClients, clientId)).toStrictEqual({
        outcome,
        ...(rotatedClient && { rotatedClient }),
        otherClientsRotated
      })
    }
  )
})

describe('isRotateOutcome', () => {
  it.each(Object.values(RotateOutcome))('is true for %s', (outcome) => {
    expect(isRotateOutcome(outcome)).toBe(true)
  })

  it.each(Object.values(ReplaceOutcome))('is false for %s', (outcome) => {
    expect(isRotateOutcome(outcome)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { isNameTaken, sharesName } from './client-names.js'

const clients = [
  { clientId: 'id-1', clientName: 'Acme Waste' },
  { clientId: 'id-2', clientName: 'Beta Tracking' }
]

describe('isNameTaken', () => {
  it.each([['Acme Waste'], ['acme WASTE']])(
    'finds %s, ignoring case',
    (name) => {
      expect(isNameTaken(clients, name)).toBe(true)
    }
  )

  it('does not find a new name', () => {
    expect(isNameTaken(clients, 'Gamma Logistics')).toBe(false)
  })

  it('ignores a client with no name', () => {
    expect(isNameTaken([{ clientId: 'id-3' }], 'Gamma Logistics')).toBe(false)
  })
})

describe('sharesName', () => {
  it('ignores the client itself', () => {
    expect(sharesName(clients, clients[0])).toBe(false)
  })

  it.each([['Acme Waste'], ['ACME waste']])(
    'finds another client named %s, ignoring case',
    (otherName) => {
      const withOther = [
        ...clients,
        { clientId: 'id-3', clientName: otherName }
      ]

      expect(sharesName(withOther, clients[0])).toBe(true)
    }
  )
})

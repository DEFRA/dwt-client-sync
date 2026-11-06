import { describe, it, expect } from 'vitest'
import { isNameTaken } from './client-names.js'

const clients = [
  { clientId: 'id-1', clientName: 'Acme_Waste' },
  { clientId: 'id-2', clientName: 'Beta_Tracking' }
]

describe('isNameTaken', () => {
  it.each([['Acme_Waste'], ['acme_WASTE']])(
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

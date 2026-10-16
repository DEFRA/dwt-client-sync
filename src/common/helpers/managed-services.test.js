import { config } from '#/config.js'
import { managedServices } from './managed-services.js'

describe('#managedServices', () => {
  const originalCognito = config.get('cognito')

  afterEach(() => {
    config.set('cognito.serviceSyncList', originalCognito.serviceSyncList)
  })

  it('returns the services in the sync list, trimmed and without blanks', () => {
    config.set('cognito.serviceSyncList', ' service-one, , service-two ')

    expect(managedServices()).toStrictEqual(['service-one', 'service-two'])
  })

  it('returns no services when the sync list is empty', () => {
    config.set('cognito.serviceSyncList', '')

    expect(managedServices()).toStrictEqual([])
  })
})

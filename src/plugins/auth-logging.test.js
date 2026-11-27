import Boom from '@hapi/boom'
import Hapi from '@hapi/hapi'
import { basicAuth } from '@defra/waste-movement-utils'

import { authLogging } from '#/plugins/auth-logging.js'
import { stsStrategy } from '#/plugins/sts-auth.js'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('#/common/helpers/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

describe('#authLogging', () => {
  let server

  beforeAll(async () => {
    server = Hapi.server()
    await server.register([basicAuth([btoa('tester=secret')]), authLogging])

    // Stands in for the STS strategy, which sts-auth.test.js covers. No
    // message on a missing token, so Hapi tries basic auth next
    server.auth.scheme(stsStrategy, () => ({
      authenticate: (request, h) =>
        request.headers.authorization === 'Bearer a-token'
          ? h.authenticated({
              credentials: { username: 'digital-waste-tracking-admin-ui' }
            })
          : h.unauthenticated(Boom.unauthorized(null, 'Bearer'))
    }))
    server.auth.strategy(stsStrategy, stsStrategy)
    server.auth.default({ strategies: [stsStrategy, 'basic'] })

    server.route([
      { method: 'GET', path: '/clients', handler: () => 'ok' },
      {
        method: 'GET',
        path: '/health',
        options: { auth: false },
        handler: () => 'ok'
      }
    ])
  })

  const call = (url, authorization) =>
    server.inject({
      method: 'GET',
      url,
      headers: authorization ? { authorization } : {}
    })

  test('Should log a caller that used an STS token', async () => {
    await call('/clients', 'Bearer a-token')

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Authenticated digital-waste-tracking-admin-ui via sts'
    )
  })

  test('Should log a caller that used basic auth', async () => {
    await call('/clients', `Basic ${btoa('tester:secret')}`)

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Authenticated tester via basic'
    )
  })

  test.each([
    ['failed to authenticate', '/clients', `Basic ${btoa('tester:wrong')}`],
    ["doesn't need auth", '/health', undefined]
  ])('Should log nothing for a request that %s', async (_, url, auth) => {
    await call(url, auth)

    expect(mockLogger.info).not.toHaveBeenCalled()
  })
})

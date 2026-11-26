describe('#createServer', () => {
  describe.each([
    ['off', false, ['basic']],
    ['on', true, ['sts', 'basic']]
  ])('With STS auth %s', (_, on, strategies) => {
    let server
    let config

    beforeAll(async () => {
      // Dynamic imports needed due to config being updated by vitest-mongodb
      ;({ config } = await import('#/config.js'))
      const { createServer } = await import('#/server.js')

      if (on) {
        config.set('stsAuth.audience', 'dwt-client-sync')
        config.set(
          'stsAuth.issuer',
          'https://example.tokens.sts.global.api.aws'
        )
        config.set(
          'stsAuth.jwksUri',
          'https://example.tokens.sts.global.api.aws/.well-known/jwks.json'
        )
        config.set('stsAuth.awsAccount', '123456789012')
      }

      server = await createServer()
    })

    afterAll(async () => {
      await server?.stop({ timeout: 0 })
      config.set('stsAuth.audience', null)
      config.set('stsAuth.issuer', null)
      config.set('stsAuth.jwksUri', null)
      config.set('stsAuth.awsAccount', null)
    })

    test(`Should authenticate with ${strategies.join(', then ')}`, () => {
      expect(server.auth.settings.default.strategies).toEqual(strategies)
    })
  })
})

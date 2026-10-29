import { describe, it, expect, vi, afterEach } from 'vitest'

async function loadConfig(env) {
  vi.resetModules()
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value)
  }
  return import('./config.js')
}

describe('config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses to start in production without the user pool id', async () => {
    await expect(
      loadConfig({ NODE_ENV: 'production', COGNITO_USER_POOL_ID: '' })
    ).rejects.toThrow('cognito.userPoolId: must be set')
  })

  it('starts in production with the user pool id', async () => {
    const { config } = await loadConfig({
      NODE_ENV: 'production',
      COGNITO_USER_POOL_ID: 'eu-west-2_TEST'
    })

    expect(config.get('cognito.userPoolId')).toBe('eu-west-2_TEST')
  })

  it('allows no user pool id outside production', async () => {
    const { config } = await loadConfig({
      NODE_ENV: 'test',
      COGNITO_USER_POOL_ID: ''
    })

    expect(config.get('cognito.userPoolId')).toBe('')
  })
})

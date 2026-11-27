import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Logs who each authenticated request came from, and how: `sts` for an STS
 * token, `basic` for basic auth. Shows which callers still use basic auth
 * before it's removed.
 */
export const authLogging = {
  plugin: {
    name: 'auth-logging',
    /**
     * @param {import('@hapi/hapi').Server} server - The server
     * @returns {void}
     */
    register(server) {
      server.ext('onPostAuth', (request, h) => {
        const { isAuthenticated, strategy, credentials } = request.auth

        if (isAuthenticated) {
          // Both strategies set it, the STS caller's service or the basic auth
          // username
          const username = /** @type {string} */ (credentials.username)
          logger.info(`Authenticated ${username} via ${strategy}`)
        }

        return h.continue
      })
    }
  }
}

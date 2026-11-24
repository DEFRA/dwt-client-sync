import Boom from '@hapi/boom'
import { createRemoteJWKSet, jwtVerify } from 'jose'

import { config } from '#/config.js'
import { createLogger } from '#/common/helpers/logging/logger.js'

const logger = createLogger()

export const stsStrategy = 'sts'

// STS signs with either, as the caller chooses
const algorithms = ['RS256', 'ES384']

// A caller's subject is its IAM role, which CDP names after the service
const roleArn = /^arn:aws:iam::(\d+):role\/([a-z0-9-]+)$/

/**
 * Whether services may call with an STS token, which needs an audience to
 * accept, and the issuer, keys and AWS account CDP sets on every service. The
 * account is required so a role with an allowed name in another account can't
 * call.
 * @returns {boolean} Whether the STS strategy is registered
 */
export function isStsAuthEnabled() {
  const { audience, issuer, jwksUri, awsAccount } = config.get('stsAuth')
  return Boolean(audience && issuer && jwksUri && awsAccount)
}

/**
 * Works out which service sent a verified token, and whether it may call.
 * @param {string} [subject] - The token's subject, the caller's IAM role
 * @returns {string} The calling service's name
 */
function callerOf(subject) {
  const { awsAccount, allowedCallers } = config.get('stsAuth')
  const [, account, service] = roleArn.exec(subject ?? '') ?? []

  // Another AWS account's role could share a service's name. Spaces are
  // trimmed, as convict doesn't when it splits STS_ALLOWED_CALLERS
  if (
    account !== awsAccount ||
    !allowedCallers.some((caller) => caller.trim() === service)
  ) {
    logger.warn(`Refused an STS token from ${subject}: not an allowed caller`)
    throw Boom.forbidden()
  }

  return service
}

/**
 * A Hapi auth scheme for AWS STS web identity tokens, as CDP's
 * service-to-service auth guide describes. A request without a Bearer token
 * is left to the other strategies, such as basic auth.
 * @param {import('jose').JWTVerifyGetKey} jwks - The issuer's public keys
 * @returns {() => import('@hapi/hapi').ServerAuthSchemeObject} The scheme
 */
function stsScheme(jwks) {
  return () => ({
    async authenticate(request, h) {
      const authorization = request.headers.authorization

      // No message, so Hapi tries the next strategy
      if (!authorization?.startsWith('Bearer ')) {
        throw Boom.unauthorized(null, 'Bearer')
      }

      const { audience, issuer } = config.get('stsAuth')
      let payload

      try {
        ;({ payload } = await jwtVerify(
          authorization.slice('Bearer '.length),
          jwks,
          { audience, issuer, algorithms }
        ))
      } catch (err) {
        // A failure to fetch the keys, as through the proxy, looks like a bad
        // token to the caller, so the reason is logged. Never the token itself
        logger.warn(
          `Rejected an STS token: ${[err.code, err.message, err.cause?.message].filter(Boolean).join(': ')}`
        )
        throw Boom.unauthorized('Invalid token', 'Bearer')
      }

      const service = callerOf(payload.sub)

      // As basic auth's credentials, so the handlers log the caller the same way
      return h.authenticated({ credentials: { username: service } })
    }
  })
}

/**
 * Registers the 'sts' auth strategy, when it's configured.
 */
export const stsAuth = {
  plugin: {
    name: 'sts-auth',
    /**
     * @param {import('@hapi/hapi').Server} server - The server
     * @param {{ jwks?: import('jose').JWTVerifyGetKey }} [options] - The
     * public keys to check against, for tests. Fetched from CDP_JWT_JWKS_URI
     * otherwise, through CDP's proxy, as Node's fetch uses NODE_USE_ENV_PROXY
     * @returns {void}
     */
    register(server, options = {}) {
      if (!isStsAuthEnabled()) {
        return
      }

      const jwks =
        options.jwks ??
        createRemoteJWKSet(new URL(config.get('stsAuth.jwksUri')))

      server.auth.scheme(stsStrategy, stsScheme(jwks))
      server.auth.strategy(stsStrategy, stsStrategy)
    }
  }
}

import { createLogger } from './logging/logger.js'

const logger = createLogger()

/**
 * Logs a request that failed validation, then rethrows its error so Hapi
 * returns the 400.
 * @param {import('@hapi/hapi').Request} _request - The request
 * @param {import('@hapi/hapi').ResponseToolkit} _h - The response toolkit
 * @param {Error} [error] - Why the request failed validation
 * @returns {never} Always throws
 */
export function failAction(_request, _h, error) {
  logger.warn(error, error?.message)
  throw error
}

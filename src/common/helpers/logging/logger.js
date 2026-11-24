import { pino } from 'pino'

import { loggerOptions } from '#/plugins/logger-options.js'

const logger = pino(loggerOptions)

/**
 * @returns {import('pino').Logger} The service's logger
 */
export function createLogger() {
  return logger
}

import { config } from '#/config.js'

/**
 * The tenant services whose clients this service syncs and manages.
 *
 * @returns {String[]} The service names in COGNITO_SERVICE_SYNC_LIST
 */
export function managedServices() {
  const { serviceSyncList } = config.get('cognito')

  return serviceSyncList
    ? serviceSyncList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
}

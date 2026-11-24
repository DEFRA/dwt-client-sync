/**
 * Takes the lock on a resource, so only one instance works on it at a time.
 * @param {import('mongo-locks').LockManager} locker - The lock manager the server is decorated with
 * @param {string} resource - What to lock, such as the sync
 * @param {import('pino').Logger} [logger] - Logs when the lock is already taken
 * @returns {Promise<import('mongo-locks').Lock | null>} The lock, or null if another instance
 * has it
 */
export async function acquireLock(locker, resource, logger) {
  const lock = await locker.lock(resource)
  if (!lock) {
    if (logger) {
      logger.error(`Failed to acquire lock for ${resource}`)
    }
    return null
  }
  return lock
}

/**
 * Takes the lock on a resource, or throws if another instance has it.
 * @param {import('mongo-locks').LockManager} locker - The lock manager the server is decorated with
 * @param {string} resource - What to lock
 * @returns {Promise<import('mongo-locks').Lock>} The lock
 */
export async function requireLock(locker, resource) {
  const lock = await locker.lock(resource)
  if (!lock) {
    throw new Error(`Failed to acquire lock for ${resource}`)
  }
  return lock
}

/**
 * Releases a lock, logging rather than throwing if it can't be, as it expires
 * by itself.
 * @param {import('mongo-locks').Lock | null} lock - The lock, or null if it wasn't taken
 * @param {import('pino').Logger} [logger] - Logs the release, and any failure
 * @returns {Promise<void>}
 */
export async function releaseLock(lock, logger) {
  if (!lock) {
    return
  }

  try {
    logger.info(`Releasing lock`)
    await lock.free()
  } catch (error) {
    if (logger) {
      logger.error(`${error.message}, Failed to release lock`)
    }
  }
}

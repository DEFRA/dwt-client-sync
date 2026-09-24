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

export async function requireLock(locker, resource) {
  const lock = await locker.lock(resource)
  if (!lock) {
    throw new Error(`Failed to acquire lock for ${resource}`)
  }
  return lock
}

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

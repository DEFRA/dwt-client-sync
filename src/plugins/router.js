import { health } from '#/routes/health.js'
import { clients } from '#/routes/clients'

export const router = {
  plugin: {
    name: 'router',
    register: (server, _options) => {
      server.route([health, ...clients])
    }
  }
}

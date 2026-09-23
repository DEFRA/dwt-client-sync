import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#/common/helpers/convict/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'dwt-client-sync'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'dwt-client-sync',
      env: 'MONGO_DATABASE'
    },
    collectionName: {
      doc: 'Collection name for clients',
      format: String,
      default: 'clients',
      env: 'CLIENTS_COLLECTION_NAME'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: [
          'primary',
          'primaryPreferred',
          'secondary',
          'secondaryPreferred',
          'nearest'
        ],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  cognito: {
    protocol: {
      doc: 'Protocol for the Cognito service',
      format: ['http', 'https'],
      default: 'http',
      env: 'COGNITO_PROTOCOL'
    },
    syncSchedule: {
      doc: 'Cron schedule for syncing Cognito credentials',
      format: String,
      default: '0 0 * * *',
      env: 'COGNITO_SYNC_SCHEDULE'
    },
    region: {
      doc: 'AWS Cognito region',
      format: String,
      default: 'eu-west-1',
      env: 'AWS_REGION'
    },
    baseUrl: {
      doc: 'Base URL for the Cognito service',
      format: String,
      default: '',
      env: 'CDP_BASE_API_URL'
    },
    signerService: {
      doc: 'AWS signer service name for signing requests to the Cognito service',
      format: String,
      default: 'execute-api',
      env: 'AWS_SIGNER_SERVICE'
    },
    listClientsPath: {
      doc: 'Path for the Cognito list clients endpoint',
      format: String,
      default: '/tenants/services/{service-name}/user-pool/fetch-details',
      env: 'COGNITO_LIST_CLIENTS_PATH'
    },
    serviceSyncList: {
      doc: 'List of services to sync',
      format: String,
      default: 'waste-movement-external-api',
      env: 'COGNITO_SERVICE_SYNC_LIST'
    }
  }
})

config.validate({ allowed: 'strict' })

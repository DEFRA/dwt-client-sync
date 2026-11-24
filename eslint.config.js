import neostandard from 'neostandard'
import { jsdoc } from 'eslint-plugin-jsdoc'

const testFiles = ['**/*.test.js']

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: neostandard.resolveIgnoresFromGitignore(),
    noJsx: true,
    noStyle: true
  }),
  jsdoc({
    config: 'flat/recommended-error',
    files: ['**/*.js'],
    ignores: testFiles,
    rules: {
      'jsdoc/no-undefined-types': ['warn', { definedTypes: ['Object'] }]
    },
    settings: {
      // Destructured parameters are typed by their root, such as
      // `@param {Saved} root0` with `@param {string} root0.owner`, so the
      // root and its properties aren't each reported as untyped
      exemptDestructuredRootsFromChecks: true
    }
  })
]

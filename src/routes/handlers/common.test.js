import { RotateOutcome } from '#/domain/client-secrets.js'
import { rotateError } from './common.js'

describe('rotateError', () => {
  it('uses the outcome unknown message it is given', () => {
    const error = rotateError(RotateOutcome.OUTCOME_UNKNOWN, 'Try again')

    expect(error.output.statusCode).toBe(502)
    expect(error.output.payload).toMatchObject({
      message: 'Try again',
      outcome: 'unknown'
    })
  })

  it('throws for an outcome that is not a failed rotate', () => {
    expect(() => rotateError(RotateOutcome.ROTATED)).toThrow(
      'Unknown rotate outcome: rotated'
    )
  })
})

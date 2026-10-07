import { convictValidatePositiveInt } from './validate-positive-int.js'

describe('#convictValidatePositiveInt', () => {
  test('With a positive integer, Should not throw', () => {
    expect(() => convictValidatePositiveInt.validate(10000)).not.toThrow()
  })

  test.each([0, -1, 1.5, Number.NaN])('With %s, Should throw', (value) => {
    expect(() => convictValidatePositiveInt.validate(value)).toThrow()
  })

  test('Should coerce strings from environment variables to numbers', () => {
    expect(convictValidatePositiveInt.coerce('5000')).toBe(5000)
  })
})

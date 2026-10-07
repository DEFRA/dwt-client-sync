import Joi from 'joi'

export const convictValidatePositiveInt = {
  name: 'positive-int',
  validate: function validatePositiveInt(value) {
    Joi.assert(value, Joi.number().integer().positive())
  },
  // Environment variables arrive as strings
  coerce: (value) => Number(value)
}

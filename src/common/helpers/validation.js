import Joi from 'joi'

export const clientSchema = Joi.object({
  clientName: Joi.string()
    .max(128)
    .pattern(/^[\w.-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'clientName must fit the regex pattern ^[\\w.-]+$',
      'string.max': 'clientName must be 128 characters or fewer'
    })
})

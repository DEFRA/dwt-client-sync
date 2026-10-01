import Joi from 'joi'

export const clientSchema = Joi.object({
  clientName: Joi.string()
    .pattern(/^[a-zA-Z0-9_]+$/)
    .required()
    .messages({
      'string.pattern.base':
        'clientName may only consist of alphanumeric characters and underscores'
    })
})

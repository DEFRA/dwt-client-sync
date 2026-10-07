import Joi from 'joi'

export const clientSchema = Joi.object({
  clientName: Joi.string()
    .pattern(/^[\w\s.-]+$/)
    .required()
    .messages({
      'string.pattern.base':
        'clientName must fit the regex pattern ^[\\w\\s.-]+$'
    })
})

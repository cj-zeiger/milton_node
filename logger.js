const winston = require('winston')

const logger = winston.createLogger({
    format: winston.format.combine(
        winston.format.splat(),
        winston.format.simple()
    ),
    transports: [
    new winston.transports.Console( {
        level: 'verbose'
    }),
    new winston.transports.File({ 
        level: 'verbose',
        filename: 'milton_verbose.log' }),
    new winston.transports.File({ 
        level: 'info',
        filename: 'milton.log' }),
  ]
});

module.exports = logger
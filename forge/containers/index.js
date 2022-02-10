/**
 * The connection to the container backend
 *
 * This handles creating, deleting, querying containers
 *
 * @namespace containers
 * @memberof forge
 */

/**
 * @typedef {Object} forge.containers.Project
 * @property {string} id - UUID that represents the project
 * @property {string} name - Name of the project
 * @property {number} team - ID of the owning team
 */

/**
 * @typedef {Object} forge.containers.Options
 * @property {string} domain - The root domain to expose the instance as
 */

/**
 * This needs work
 *
 * @typedef {Object} forge.containers.ProjectArguemnts
 *
 */

/**
 * @typedef {Object} forge.Status
 * @property {string} status
 */

const fp = require('fastify-plugin')

module.exports = fp(async function (app, _opts, next) {
    const containerDialect = app.config.driver.type
    const containerModule = containerDialect === 'stub'
        ? './stub/index.js'
        : `@flowforge/${containerDialect}`

    try {
        const driver = require(containerModule)
        await driver.init(app, {
            domain: app.config.domain || 'example.com',
            // this list needs loading from an external source
            containers: {
                basic: 'flowforge/node-red'
            }
        })
        app.decorate('containers', driver)
        app.log.info(`Container driver: ${containerDialect}`)
        app.addHook('onClose', async(_) => {
            app.log.info("Driver shutdown")
            if (driver.shutdown) {
                await driver.shutdown()
            }
        })
    } catch (err) {
        app.log.error('Failed to load the container driver')
        throw err
    }

    next()
})

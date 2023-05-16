/* eslint-disable n/no-process-exit */
'use strict'

const app = require('./environments/standard')

;(async function () {
    const flowforge = await app()
    const PORT = 3000
    flowforge.listen(PORT, function (err, address) {
        console.info(`Environment running at http://localhost:${PORT}`)
        if (err) {
            console.error(err)
            process.exit(1)
        }
    })
})()

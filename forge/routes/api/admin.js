
module.exports = async function (app) {
    app.get('/stats', { preHandler: app.needsPermission('platform:stats') }, async (request, reply) => {
        const userCount = await app.db.models.User.count({ attributes: ['admin'], group: 'admin' })
        const projectStateCounts = await app.db.models.Project.count({ attributes: ['state'], group: 'state' })
        const license = await app.license.get() || app.license.defaults
        const result = {
            userCount: 0,
            maxUsers: license.users,
            deviceCount: await app.db.models.Device.count(),
            maxDevices: license.devices,
            inviteCount: await app.db.models.Invitation.count(),
            adminCount: 0,
            teamCount: await app.db.models.Team.count(),
            maxTeams: license.teams,
            projectCount: 0,
            maxProjects: license.projects,
            projectsByState: {}
        }
        userCount.forEach(u => {
            result.userCount += u.count
            if (u.admin === 1) {
                result.adminCount = u.count
            }
        })

        projectStateCounts.forEach(projectState => {
            result.projectCount += projectState.count
            result.projectsByState[projectState.state] = projectState.count
        })
        reply.send(result)
    })

    app.get('/license', { preHandler: app.needsPermission('license:read') }, async (request, reply) => {
        reply.send(app.license.get() || {})
    })

    app.put('/license', {
        preHandler: app.needsPermission('license:edit'),
        schema: {
            body: {
                type: 'object',
                required: ['license', 'action'],
                properties: {
                    license: { type: 'string' },
                    action: { type: 'string' }
                }
            }
        }
    }, async (request, reply) => {
        try {
            if (request.body.action === 'apply') {
                await app.license.apply(request.body.license)
                const license = app.license.get() || {}
                await app.auditLog.Platform.platform.license.applied(request.session.User, null, license)
                reply.send(license)
            } else if (request.body.action === 'inspect') {
                const license = await app.license.inspect(request.body.license)
                await app.auditLog.Platform.platform.license.inspected(request.session.User, null, license)
                reply.send(license)
            } else {
                reply.code(400).send({ code: 'invalid_license_action', error: 'Invalid action' })
            }
        } catch (err) {
            let responseMessage = err.toString()
            if (/malformed/.test(responseMessage)) {
                responseMessage = 'Failed to parse license'
            }
            const resp = { code: 'invalid_license', error: responseMessage }
            if (request.body.action === 'apply') {
                await app.auditLog.Platform.platform.license.applied(request.session.User, resp, request.body.license)
            } else if (request.body.action === 'inspect') {
                await app.auditLog.Platform.platform.license.inspected(request.session.User, resp, request.body.license)
            }
            reply.code(400).send(resp)
        }
    })

    app.get('/invitations', { preHandler: app.needsPermission('invitation:list') }, async (request, reply) => {
        // TODO: Pagination
        const invitations = await app.db.models.Invitation.get()
        const result = app.db.views.Invitation.invitationList(invitations)
        reply.send({
            meta: {}, // For future pagination
            count: result.length,
            invitations: result
        })
    })

    app.get('/debug/db-migrations', { preHandler: app.needsPermission('platform:debug') }, async (request, reply) => {
        reply.send((await app.db.sequelize.query('select * from "MetaVersions"'))[0])
    })
    app.get('/debug/db-schema', { preHandler: app.needsPermission('platform:debug') }, async (request, reply) => {
        const result = {}
        let tables
        if (app.config.db.type === 'postgres') {
            const response = await app.db.sequelize.query('select * from information_schema.tables')
            const tt = response[0]
            tables = []
            for (let i = 0; i < tt.length; i++) {
                const table = tt[i]
                if (table.table_schema === 'public') {
                    tables.push(table.table_name)
                }
            }
        } else {
            const response = await app.db.sequelize.showAllSchemas()
            tables = response.map(t => t.name)
        }
        for (let i = 0; i < tables.length; i++) {
            result[tables[i]] = await app.db.sequelize.getQueryInterface().describeTable(tables[i])
        }

        reply.send(result)
    })
    /**
     * Get platform audit logs
     * @name /api/v1/admin/audit-log
     * @memberof forge.routes.api.admin
     */
    app.get('/audit-log', { preHandler: app.needsPermission('platform:audit-log') }, async (request, reply) => {
        const paginationOptions = app.getPaginationOptions(request)
        const logEntries = await app.db.models.AuditLog.forPlatform(paginationOptions)
        const result = app.db.views.AuditLog.auditLog(logEntries)
        reply.send(result)
    })
}

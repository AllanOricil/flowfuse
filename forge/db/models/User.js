/**
 * A User
 * @namespace forge.db.models.User
 */
const { DataTypes, Op } = require('sequelize')
const { hash, generateUserAvatar } = require('../utils')

module.exports = {
    name: 'User',
    schema: {
        username: { type: DataTypes.STRING, allowNull: false, unique: true },
        name: { type: DataTypes.STRING, validate: { not: /:\/\// } },
        email: { type: DataTypes.STRING, unique: true, validate: { isEmail: true } },
        email_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
        password: {
            type: DataTypes.STRING,
            set (value) {
                if (value.length < 8) {
                    throw new Error('Password too short')
                }
                this.setDataValue('password', hash(value))
            }
        },
        password_expired: { type: DataTypes.BOOLEAN, defaultValue: false },
        admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        avatar: {
            type: DataTypes.STRING,
            get () {
                const avatar = this.getDataValue('avatar')
                if (avatar) {
                    return `${process.env.FLOWFORGE_BASE_URL}${avatar}`
                } else {
                    return avatar
                }
            }
        }
    },
    scopes: {
        admins: { where: { admin: true } }
    },
    hooks: function (M, app) {
        return {
            beforeCreate: async (user, options) => {
                const userLimit = app.license.get('users')
                const userCount = await M.User.count()
                if (userCount >= userLimit) {
                    throw new Error('license limit reached')
                }
                if (!user.avatar) {
                    user.avatar = generateUserAvatar(user.name || user.username)
                }
                if (!user.name) {
                    user.name = user.username
                }
            },
            beforeUpdate: async (user) => {
                if (user._previousDataValues.admin === true && user.admin === false) {
                    const currentAdmins = await app.db.models.User.scope('admins').findAll()
                    console.log(currentAdmins)
                    if (currentAdmins.length <= 1) {
                        throw new Error('Cannot remove last Admin user')
                    }
                }
                if (user.avatar.startsWith(`${process.env.FLOWFORGE_BASE_URL}/avatar/`)) {
                    user.avatar = generateUserAvatar(user.name || user.username)
                }
            },
            beforeDestroy: async (user, opts) => {
                if (user.admin) {
                    throw new Error('Cannot delete Admin user')
                }
                const teamsOwned = await user.getTeamsOwned()
                if (teamsOwned.length > 0) {
                    throw new Error('Cannot delete user that owns teams')
                }
                // Need to do this in beforeDestroy as the Session.UserId field
                // is set to NULL when user is deleted.
                // TODO: modify cascade delete relationship between the tables
                await M.Session.destroy({
                    where: {
                        UserId: user.id
                    }
                })
                await M.Invitation.destroy({
                    where: {
                        [Op.or]: [{ invitorId: user.id }, { inviteeId: user.id }]
                    }
                })
            }
        }
    },
    associations: function (M) {
        this.belongsToMany(M.Team, { through: M.TeamMember })
        this.hasMany(M.TeamMember)
        this.hasMany(M.Session)
        this.hasMany(M.Invitation, { foreignKey: 'invitorId' })
        this.hasMany(M.Invitation, { foreignKey: 'inviteeId' })
        this.belongsTo(M.Team, { as: 'defaultTeam' })
    },
    finders: function (M) {
        return {
            static: {
                admins: async () => {
                    return this.scope('admins').findAll()
                },
                byId: async (id) => {
                    if (typeof id === 'string') {
                        id = M.User.decodeHashid(id)
                    }
                    return this.findOne({
                        where: { id },
                        include: {
                            model: M.Team,
                            attributes: ['name'],
                            through: {
                                attributes: ['role']
                            }
                        }
                    })
                },
                byUsername: async (username) => {
                    return this.findOne({
                        where: { username },
                        include: {
                            model: M.Team,
                            attributes: ['name'],
                            through: {
                                attributes: ['role']
                            }
                        }
                    })
                },
                byEmail: async (email) => {
                    return this.findOne({
                        where: { email },
                        include: {
                            model: M.Team,
                            attributes: ['name'],
                            through: {
                                attributes: ['role']
                            }
                        }
                    })
                },
                byName: async (name) => {
                    return this.findOne({
                        where: { name },
                        include: {
                            model: M.Team,
                            attributes: ['name'],
                            through: {
                                attributes: ['role']
                            }
                        }
                    })
                },
                byUsernameOrEmail: async (name) => {
                    let clause = { username: name }
                    if (/.+@.+/.test(name)) {
                        clause = { email: name }
                    }
                    return this.findOne({
                        where: clause,
                        include: {
                            model: M.Team,
                            attributes: ['name'],
                            through: {
                                attributes: ['role']
                            }
                        }
                    })
                },
                inTeam: async (teamHashId) => {
                    const teamId = M.Team.decodeHashid(teamHashId)
                    return M.User.findAll({
                        include: {
                            model: M.Team,
                            attributes: ['name'],
                            where: { id: teamId },
                            through: {
                                attributes: ['role']
                            }
                        }
                    })
                },
                getAll: async (pagination = {}) => {
                    const limit = parseInt(pagination.limit) || 30
                    const where = {}
                    if (pagination.cursor) {
                        where.id = { [Op.gt]: M.User.decodeHashid(pagination.cursor) }
                    }
                    const { count, rows } = await this.findAndCountAll({
                        where,
                        order: [['id', 'ASC']],
                        limit
                    })
                    return {
                        meta: {
                            next_cursor: rows.length === limit ? rows[rows.length - 1].hashid : undefined
                        },
                        count,
                        users: rows
                    }
                }
            },
            instance: {
                // get the team membership for the given team
                // `teamId` can be either a number (the raw id) or a string (the hashid).
                // TODO: standardize on using hashids externally
                getTeamMembership: async function (teamId, includeTeam) {
                    return M.TeamMember.getTeamMembership(this.id, teamId, includeTeam)
                },
                getTeamsOwned: async function () {
                    return M.TeamMember.getTeamsOwnedBy(this.id)
                }
            }
        }
    }
}

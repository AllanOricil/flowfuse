const should = require('should') // eslint-disable-line

const setup = require('../setup')

describe('Accounts API', async function () {
    let app
    const TestObjects = { tokens: {} }

    async function registerUser (payload) {
        return app.inject({
            method: 'POST',
            url: '/account/register',
            payload
        })
    }

    async function login (username, password) {
        const response = await app.inject({
            method: 'POST',
            url: '/account/login',
            payload: { username, password, remember: false }
        })
        response.cookies.should.have.length(1)
        response.cookies[0].should.have.property('name', 'sid')
        TestObjects.tokens[username] = response.cookies[0].value
    }

    describe('Register User', async function () {
        before(async function () {
            app = await setup()
        })
        after(async function () {
            await app.close()
        })
        afterEach(async function () {
            // Reset settings to default
            app.settings.set('user:signup', false)
            app.settings.set('team:user:invite:external', false)
            app.settings.set('user:team:auto-create', false)
            app.license.defaults.users = 150
        })

        async function expectRejection (opts, reason) {
            const response = await registerUser(opts)
            response.statusCode.should.equal(400)
            response.json().error.should.match(reason)
        }

        it('rejects user registration if not enabled', async function () {
            app.settings.get('user:signup').should.be.false()
            app.settings.get('team:user:invite:external').should.be.false()
            await expectRejection({
                username: 'u1',
                password: 'p1',
                name: 'u1',
                email: 'u1@example.com'
            }, /user registration not enabled/)

            // TODO: check user audit logs - expect 'account.xxx-yyy' { code: '', error, '' }
        })
        it('allows user to register', async function () {
            app.settings.set('user:signup', true)

            const response = await registerUser({
                username: 'u1',
                password: '12345678',
                name: 'u1',
                email: 'u1@example.com'
            })
            response.statusCode.should.equal(200)
            const result = response.json()
            result.should.have.property('username', 'u1')
            result.should.have.property('id')
            // Ensure the id looks like a hash id
            result.id.should.not.match(/^\d+$/)
            // TODO: check user audit logs - expect 'account.xxx-yyy' { status: 'okay', ... }
        })

        it('rejects reserved user names', async function () {
            app.settings.set('user:signup', true)

            await expectRejection({
                username: 'admin',
                password: '12345678',
                name: 'u1',
                email: 'u1@example.com'
            }, /invalid username/)

            await expectRejection({
                username: 'root',
                password: '12345678',
                name: 'u1',
                email: 'u1@example.com'
            }, /invalid username/)

            // TODO: check user audit logs - expect 'account.xxx-yyy' { code: '', error, '' }
        })

        it('rejects duplicate username', async function () {
            app.settings.set('user:signup', true)

            await registerUser({
                username: 'u1',
                password: '12345678',
                name: 'u1',
                email: 'u1@example.com'
            })

            await expectRejection({
                username: 'u1',
                password: '12345678',
                name: 'u1.2',
                email: 'u1-2@example.com'
            }, /username not available/)

            // TODO: check user audit logs - expect 'account.xxx-yyy' { code: '', error, '' }
        })
        it('rejects duplicate email', async function () {
            app.settings.set('user:signup', true)

            await registerUser({
                username: 'u1',
                password: '12345678',
                name: 'u1',
                email: 'u1@example.com'
            })

            await expectRejection({
                username: 'u1-2',
                password: '12345678',
                name: 'u1.2',
                email: 'u1@example.com'
            }, /email not available/)

            // TODO: check user audit logs - expect 'account.xxx-yyy' { code: '', error, '' }
        })

        it('Limits how many users can be created when unlicensed', async function () {
            app.settings.set('user:signup', true)
            const currentCount = await app.db.models.User.count()
            app.license.defaults.users = currentCount + 2
            for (let i = currentCount; i < currentCount + 2; i++) {
                const resp = await registerUser({
                    username: `u-limit-${i}`,
                    password: '12345678',
                    name: `u-limit-${i}`,
                    email: `u-limit-${i}@example.com`
                })
                resp.statusCode.should.equal(200)
            }
            await expectRejection({
                username: 'u-final',
                password: '12345678',
                name: 'u-final',
                email: 'u-final@example.com'
            }, /license limit reached/)

            // TODO: check user audit logs - expect 'account.xxx-yyy' { code: '', error, '' }
        })

        it('allows user to register with + in email (no sso)', async function () {
            app.settings.set('user:signup', true)

            const response = await registerUser({
                username: 'u7',
                password: '12345678',
                name: 'u7',
                email: 'u7+test@example.com'
            })
            response.statusCode.should.equal(200)

            // TODO: check user audit logs - expect 'account.xxx-yyy' { status: 'okay', ... }
        })

        it('auto-creates personal team if option set - default team type', async function () {
            app.settings.set('user:signup', true)
            app.settings.set('user:team:auto-create', true)

            const response = await registerUser({
                username: 'user',
                password: '12345678',
                name: 'user',
                email: 'user@example.com'
            })
            response.statusCode.should.equal(200)

            // Team is only created once they verify their email.
            const user = await app.db.models.User.findOne({ where: { username: 'user' } })
            const verificationToken = await app.db.controllers.User.generateEmailVerificationToken(user)
            await app.inject({
                method: 'POST',
                url: `/account/verify/${verificationToken}`,
                payload: {},
                cookies: { sid: TestObjects.tokens.user }
            })
            await login('user', '12345678')

            const userTeamsResponse = await app.inject({
                method: 'GET',
                url: '/api/v1/user/teams',
                cookies: { sid: TestObjects.tokens.user }
            })

            const userTeams = userTeamsResponse.json()
            userTeams.should.have.property('teams')
            userTeams.teams.should.have.length(1)
        })

        it('auto-creates personal team if option set - selected team type', async function () {
            app.settings.set('user:signup', true)
            app.settings.set('user:team:auto-create', true)

            const newTeamType = await app.db.models.TeamType.create({
                name: 'new-starter',
                properties: {}
            })
            app.settings.set('user:team:auto-create:teamType', newTeamType.hashid)

            const response = await registerUser({
                username: 'user2',
                password: '12345678',
                name: 'user',
                email: 'user2@example.com'
            })
            response.statusCode.should.equal(200)

            // Team is only created once they verify their email.
            const user = await app.db.models.User.findOne({ where: { username: 'user2' } })
            const verificationToken = await app.db.controllers.User.generateEmailVerificationToken(user)
            await app.inject({
                method: 'POST',
                url: `/account/verify/${verificationToken}`,
                payload: {},
                cookies: { sid: TestObjects.tokens.user2 }
            })
            await login('user2', '12345678')

            const userTeamsResponse = await app.inject({
                method: 'GET',
                url: '/api/v1/user/teams',
                cookies: { sid: TestObjects.tokens.user2 }
            })

            const userTeams = userTeamsResponse.json()
            userTeams.should.have.property('teams')
            userTeams.teams.should.have.length(1)
            userTeams.teams[0].should.have.property('type')
            userTeams.teams[0].type.should.have.property('id', newTeamType.hashid)

            // cleanup else this becomes the new default and breaks other tests
            newTeamType.active = false
            await newTeamType.save()
            app.settings.set('user:team:auto-create:teamType', null)
        })

        describe('auto-creation of application and instances', function () {
            it('auto-creates an instance if instanceType option is set', async function () {
                app.settings.set('user:signup', true)
                app.settings.set('user:team:auto-create', true)
                app.settings.set('user:team:auto-create:instanceType', app.projectType.hashid)

                const response = await registerUser({
                    username: 'user3',
                    password: '12345678',
                    name: 'user',
                    email: 'user3@example.com'
                })
                response.statusCode.should.equal(200)

                // Process only runs after email verification
                const user = await app.db.models.User.findOne({ where: { username: 'user3' } })
                const verificationToken = await app.db.controllers.User.generateEmailVerificationToken(user)
                const verifyResponse = await app.inject({
                    method: 'POST',
                    url: `/account/verify/${verificationToken}`,
                    payload: {},
                    cookies: { sid: TestObjects.tokens.user3 }
                })
                verifyResponse.statusCode.should.equal(200)

                const instances = await app.db.models.Project.byUser(user)
                instances.length.should.equal(1)

                const instance = instances[0]
                instance.safeName.should.match(/team-user-user3-(\w)+/)
            })

            it('auto-creates an application & instance if instanceType option is set and there is no application yet', async function () {
                app.settings.set('user:signup', true)
                app.settings.set('user:team:auto-create', true)
                app.settings.set('user:team:auto-create:instanceType', app.projectType.hashid)

                const response = await registerUser({
                    username: 'user4',
                    password: '12345678',
                    name: 'dave',
                    email: 'user4@example.com'
                })
                response.statusCode.should.equal(200)

                // Process only runs after email verification
                const user = await app.db.models.User.findOne({ where: { username: 'user4' } })
                const verificationToken = await app.db.controllers.User.generateEmailVerificationToken(user)
                const verifyResponse = await app.inject({
                    method: 'POST',
                    url: `/account/verify/${verificationToken}`,
                    payload: {},
                    cookies: { sid: TestObjects.tokens.user4 }
                })
                verifyResponse.statusCode.should.equal(200)

                const teams = await app.db.models.Team.forUser(user)
                const userTeam = teams[0].Team

                const applications = await app.db.models.Application.byTeam(userTeam.id, { includeInstances: true })
                applications.length.should.equal(1)

                const application = applications[0]
                application.name.should.match('Dave\'s Application')

                application.Instances.length.should.equal(1)
                application.Instances[0].safeName.should.match(/team-dave-user4-(\w)+/)
            })

            it('handles a custom team type being set, still creating an application & instance if the flag is set', async function () {
                app.settings.set('user:signup', true)
                app.settings.set('user:team:auto-create', true)
                app.settings.set('user:team:auto-create:instanceType', app.projectType.hashid)

                // Allow this new project type to be used by the new team type
                const teamTypeProperties = { instances: {} }
                teamTypeProperties.instances[app.projectType.hashid] = {
                    active: true,
                    limit: 2,
                    free: 2
                }
                const newTeamType = await app.db.models.TeamType.create({
                    name: 'new-starter-test',
                    properties: teamTypeProperties
                })
                app.settings.set('user:team:auto-create:teamType', newTeamType.hashid)

                const response = await registerUser({
                    username: 'user5',
                    password: '12345678',
                    name: 'Pez Cuckow',
                    email: 'user5@example.com'
                })
                response.statusCode.should.equal(200)

                // Process only runs after email verification
                const user = await app.db.models.User.findOne({ where: { username: 'user5' } })
                const verificationToken = await app.db.controllers.User.generateEmailVerificationToken(user)
                const verifyResponse = await app.inject({
                    method: 'POST',
                    url: `/account/verify/${verificationToken}`,
                    payload: {},
                    cookies: { sid: TestObjects.tokens.user4 }
                })
                verifyResponse.statusCode.should.equal(200)

                const teams = await app.db.models.Team.forUser(user)
                const userTeam = teams[0].Team

                const applications = await app.db.models.Application.byTeam(userTeam.id, { includeInstances: true })
                applications.length.should.equal(1)

                const application = applications[0]
                application.name.should.match('Pez Cuckow\'s Application')

                application.Instances.length.should.equal(1)
                application.Instances[0].safeName.should.match(/team-pez-cuckow-user5-(\w)+/)

                // cleanup else this becomes the new default and breaks other tests
                newTeamType.active = false
                await newTeamType.save()
                app.settings.set('user:team:auto-create:teamType', null)
            })
        })

        describe('licensed instances', function () {
            before(async function () {
                // close the default app
                await app.close()
            })
            afterEach(async function () {
                await app.close()
            })
            after(async function () {
                app = await setup()
            })
            it('auto-creates personal team if option set - in trial mode', async function () {
                const license = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJGbG93Rm9yZ2UgSW5jLiIsInN1YiI6IkZsb3dGb3JnZSBJbmMuIERldmVsb3BtZW50IiwibmJmIjoxNjYyNTA4ODAwLCJleHAiOjc5ODY5ODg3OTksIm5vdGUiOiJEZXZlbG9wbWVudC1tb2RlIE9ubHkuIE5vdCBmb3IgcHJvZHVjdGlvbiIsInVzZXJzIjo1LCJ0ZWFtcyI6NTAsInByb2plY3RzIjo1MCwiZGV2aWNlcyI6NTAsImRldiI6dHJ1ZSwiaWF0IjoxNjYyNTQ4NjAyfQ.vvSw6pm-NP5e0NUL7yMOG-w0AgB8H3NRGGN7b5Dw_iW5DiIBbVQ4HVLEi3dyy9fk7WgKnloiCCkIFJvN79fK_g'
                const TEST_TRIAL_DURATION = 5

                app = await setup({ license, billing: { stripe: {} } })
                app.settings.set('user:signup', true)
                app.settings.set('user:team:auto-create', true)

                // Set trial mode options against the default team type
                const teamType = await app.db.models.TeamType.findOne({ where: { id: 1 } })
                const props = teamType.properties
                props.trial = {
                    active: true,
                    duration: TEST_TRIAL_DURATION
                }
                teamType.properties = props
                await teamType.save()

                const response = await registerUser({
                    username: 'user',
                    password: '12345678',
                    name: 'user',
                    email: 'user@example.com'
                })
                response.statusCode.should.equal(200)

                // Team is only created once they verify their email.
                const user = await app.db.models.User.findOne({ where: { username: 'user' } })
                const verificationToken = await app.db.controllers.User.generateEmailVerificationToken(user)
                await app.inject({
                    method: 'POST',
                    url: `/account/verify/${verificationToken}`,
                    payload: {},
                    cookies: { sid: TestObjects.tokens.user }
                })
                await login('user', '12345678')

                const userTeamsResponse = await app.inject({
                    method: 'GET',
                    url: '/api/v1/user/teams',
                    cookies: { sid: TestObjects.tokens.user }
                })

                const userTeams = userTeamsResponse.json()
                userTeams.should.have.property('teams')
                userTeams.teams.should.have.length(1)

                const userTeam = await app.db.models.Team.byId(userTeams.teams[0].id)
                const subscription = await app.db.models.Subscription.byTeamId(userTeam.id)
                should.exist(subscription)
                subscription.isActive().should.be.false()
                subscription.isTrial().should.be.true()
                subscription.isTrialEnded().should.be.false()
                subscription.trialStatus.should.equal(app.db.models.Subscription.TRIAL_STATUS.CREATED)
            })
            it('Does not limit how many users can be created when licensed', async function () {
                // This license has limit of 5 users (1 created by default test setup (test/unit/forge/routes/setup.js))
                const license = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJGbG93Rm9yZ2UgSW5jLiIsInN1YiI6IkZsb3dGb3JnZSBJbmMuIERldmVsb3BtZW50IiwibmJmIjoxNjYyNTA4ODAwLCJleHAiOjc5ODY5ODg3OTksIm5vdGUiOiJEZXZlbG9wbWVudC1tb2RlIE9ubHkuIE5vdCBmb3IgcHJvZHVjdGlvbiIsInVzZXJzIjo1LCJ0ZWFtcyI6NTAsInByb2plY3RzIjo1MCwiZGV2aWNlcyI6NTAsImRldiI6dHJ1ZSwiaWF0IjoxNjYyNTQ4NjAyfQ.vvSw6pm-NP5e0NUL7yMOG-w0AgB8H3NRGGN7b5Dw_iW5DiIBbVQ4HVLEi3dyy9fk7WgKnloiCCkIFJvN79fK_g'
                app = await setup({ license })
                app.settings.set('user:signup', true)
                // Register 5 more users to breach the limit
                for (let i = 1; i <= 5; i++) {
                    const resp = await registerUser({
                        username: `u${i}`,
                        password: '12345678',
                        name: `u${i}`,
                        email: `u${i}@example.com`
                    })
                    resp.statusCode.should.equal(200)
                }
                // TODO: check user audit logs - expect 'account.xxx-yyy' { code: '', error, '' }
            })
        })
    })

    describe.only('Verify FF Tokens', async function () {
        before(async function () {
            app = await setup()
        })
        after(async function () {
            await app.close()
        })
        it('Test token belongs to a project', async function () {
            const authTokens = await app.project.refreshAuthTokens()
            const response = await app.inject({
                method: 'GET',
                url: `/account/check/project/${app.project.id}`,
                headers: {
                    authorization: `Bearer ${authTokens.token}`
                }
            })
            response.statusCode.should.equal(200)
        })

        it('Fail to verify with random project id', async function () {
            const authTokens = await app.project.refreshAuthTokens()
            const response = await app.inject({
                method: 'GET',
                url: '/account/check/project/random',
                headers: {
                    authorization: `Bearer ${authTokens.token}`
                }
            })
            response.statusCode.should.equal(401)
        })

        it('Fail to verify with random project id', async function () {
            const authTokens = await app.project.refreshAuthTokens()
            const response = await app.inject({
                method: 'GET',
                url: `/account/check/team/${app.project.id}`,
                headers: {
                    authorization: `Bearer ${authTokens.token}`
                }
            })
            response.statusCode.should.equal(401)
        })

        it('Test token gets quota', async function () {
            const authTokens = await app.project.refreshAuthTokens()
            const response = await app.inject({
                method: 'GET',
                url: `/account/check/project/${app.project.id}`,
                headers: {
                    authorization: `Bearer ${authTokens.token}`,
                    'ff-quota': 'true' 
                }
            })
            response.statusCode.should.equal(200)
            const body = response.body
            console.log(body)
        })
    })
})

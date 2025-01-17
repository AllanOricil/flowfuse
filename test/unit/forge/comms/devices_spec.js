const sleep = require('util').promisify(setTimeout)

const should = require('should') // eslint-disable-line
const setup = require('../routes/setup')

const FF_UTIL = require('flowforge-test-utils')
const { DeviceCommsHandler } = FF_UTIL.require('forge/comms/devices')

describe('DeviceCommsHandler', function () {
    let app
    const TestObjects = {}

    async function setupCE () {
        app = await setup()
        await setupTestObjects()
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

    async function setupTestObjects () {
        // alice : admin
        // ATeam ( alice  (owner) )

        // Alice create in setup()
        TestObjects.alice = await app.db.models.User.byUsername('alice')
        // ATeam create in setup()
        TestObjects.ATeam = await app.db.models.Team.byName('ATeam')
        // Alice set as ATeam owner in setup()

        TestObjects.ProjectA = app.project
        TestObjects.ProjectACredentials = await TestObjects.ProjectA.refreshAuthTokens()

        TestObjects.device = await app.factory.createDevice({
            name: 'device1'
        }, TestObjects.ATeam)

        TestObjects.applicationDevice = await app.factory.createDevice({
            name: 'device2',
            ownerType: 'application'
        }, TestObjects.ATeam)

        TestObjects.tokens = {}
        await login('alice', 'aaPassword')
    }

    before(async function () {
        return setupCE()
    })
    after(async function () {
        await app.close()
    })
    /**
     * Get a mocked websocket/socket object. They are 99% the same for the purposes
     * of our tests - only different being one uses 'publish' and one uses 'send'
     */
    function mockSocket () {
        let received = []
        const handlers = {}
        return {
            platformId: 'test-platform-id',
            publish: (topic, payload, opts, callback) => {
                received.push({ topic, payload })
                if (callback) {
                    setImmediate(() => callback())
                }
            },
            send: (data) => {
                received.push(data)
            },
            on: (event, callback) => {
                handlers[event] = callback
            },
            emit: function () {
                const evt = arguments[0]
                const args = Array.prototype.slice.call(arguments, 1)
                handlers[evt].apply(null, args)
            },
            received: () => received,
            clearReceived: () => { received = [] }
        }
    }

    describe('Device Logs', function () {
        let commsHandler
        let client
        const sockets = []
        before(function () {
            client = mockSocket()
            commsHandler = DeviceCommsHandler(app, client)
        })

        it('tells a device to start streaming logs', async function () {
            sockets.push(mockSocket())
            commsHandler.streamLogs(TestObjects.ATeam.hashid, TestObjects.device.hashid, sockets[0])

            client.received().should.have.length(1)
            const msg = client.received()[0]
            msg.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            msg.should.have.property('payload')
            const payload = JSON.parse(msg.payload)
            payload.should.have.property('command', 'startLog')
            client.clearReceived()
        })
        it('streams logs to socket', async function () {
            client.emit('logs/device', {
                id: TestObjects.device.hashid,
                logs: 'm1'
            })
            sockets[0].received().should.have.length(1)
            sockets[0].received()[0].should.equal('m1')
            sockets[0].clearReceived()
        })
        it('supports multiple active ws connections', async function () {
            sockets.push(mockSocket())
            commsHandler.streamLogs(TestObjects.ATeam.hashid, TestObjects.device.hashid, sockets[1])
            // Already streaming, so should not trigger another command
            client.received().should.have.length(0)

            client.emit('logs/device', {
                id: TestObjects.device.hashid,
                logs: 'm2'
            })
            sockets[0].received().should.have.length(1)
            sockets[0].received()[0].should.equal('m2')
            sockets[0].clearReceived()
            // New socket should receive previous messages
            sockets[1].received().should.have.length(2)
            sockets[1].received()[0].should.equal('m1')
            sockets[1].received()[1].should.equal('m2')
            sockets[1].clearReceived()
        })
        it('handles socket close', async function () {
            // Close sockets[1] - verify sockets[0] still gets messages
            sockets[1].emit('close')
            // Still got an active socket, so no command should be sent
            client.received().should.have.length(0)

            client.emit('logs/device', {
                id: TestObjects.device.hashid,
                logs: 'm3'
            })
            // Existing socket should still receive it
            sockets[0].received().should.have.length(1)
            sockets[0].clearReceived()
            sockets[1].received().should.have.length(0)
        })
        it('caches last 10 messages', async function () {
            // Send 8 more messages so 11 have been sent in total
            for (let i = 4; i < 12; i++) {
                client.emit('logs/device', {
                    id: TestObjects.device.hashid,
                    logs: `m${i}`
                })
            }
            // soc0 already received m1-m3
            sockets[0].received().should.have.length(8)
            sockets[0].clearReceived()

            // soc2
            sockets.push(mockSocket())
            commsHandler.streamLogs(TestObjects.ATeam.hashid, TestObjects.device.hashid, sockets[2])
            // Already streaming, so should not trigger another command
            client.received().should.have.length(0)

            await sleep(50)
            // Should only have received 10 messages, starting with m2
            sockets[2].received().should.have.length(10)
            sockets[2].received()[0].should.equal('m2')
            sockets[2].received()[9].should.equal('m11')

            // Close the socket
            sockets[2].emit('close')
            await sleep(10)
        })

        it('handles socket close - last remaining', async function () {
            // Close sockets[0] - verify command sent to stop
            sockets[0].emit('close')
            // Still got an active socket, so no command should be sent
            client.received().should.have.length(1)
            const msg = client.received()[0]
            msg.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            msg.should.have.property('payload')
            const payload = JSON.parse(msg.payload)
            payload.should.have.property('command', 'stopLog')
            client.clearReceived()
        })
        it('tells a device to stop if it sends logs without active sockets', async function () {
            client.emit('logs/device', {
                id: TestObjects.device.hashid,
                logs: 'mxx'
            })
            // This task happens asynchronously - so need to give it a chance
            // to happen
            await sleep(100)
            const msg = client.received()[0]
            msg.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            msg.should.have.property('payload')
            const payload = JSON.parse(msg.payload)
            payload.should.have.property('command', 'stopLog')

            sockets[0].received().should.have.length(0)
            sockets[1].received().should.have.length(0)
        })
    })

    describe('Device Status', function () {
        let oldHandler
        let client
        beforeEach(function () {
            client = mockSocket()
            const commsHandler = DeviceCommsHandler(app, client)

            oldHandler = app.comms.devices
            app.comms.devices = commsHandler
        })

        after(function () {
            app.comms.devices = oldHandler
        })

        it('handles the device is not found', async function () {
            client.emit('status/device', {
                id: 'bad-device-id',
                status: 'online'
            })

            // Task happens async
            await sleep(100)
        })

        it('handles receiving a status payload with unknown objects', async function () {
            client.emit('status/device', {
                id: TestObjects.device.hashid,
                status: JSON.stringify({
                    state: 'online',
                    project: 'unknown-project',
                    application: 'unknown-application',
                    snapshot: 'unknown-snapshot',
                    settings: 'incorrect-settings'
                })
            })

            // Task happens async
            await sleep(100)

            // Should have received update command
            client.received().should.have.length(1)

            const msg = client.received()[0]
            msg.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            msg.should.have.property('payload')
            const payload = JSON.parse(msg.payload)
            payload.should.have.property('command', 'update')
        })

        it('updates the active snapshot ID if it is found in the database', async function () {
            TestObjects.device.Team = await TestObjects.device.getTeam() // .Team is not loaded in the tests

            const knownSnapshot = await app.db.models.ProjectSnapshot.create({
                name: 'Test Snapshot',
                description: 'Test Description',
                flows: {},
                ApplicationId: TestObjects.device.ApplicationId,
                DeviceId: TestObjects.applicationDevice.id,
                UserId: TestObjects.alice.id
            })

            client.emit('status/device', {
                id: TestObjects.applicationDevice.hashid,
                status: JSON.stringify({
                    state: 'online',
                    snapshot: knownSnapshot.hashid
                })
            })

            // Task happens async
            await sleep(100)

            await TestObjects.applicationDevice.reload()

            TestObjects.applicationDevice.activeSnapshotId.should.equal(knownSnapshot.id)
        })

        it('sends update to clear application device configuration if device agent is older than 1.11.0', async function () {
            client.emit('status/device', {
                id: TestObjects.applicationDevice.hashid,
                status: JSON.stringify({
                    state: 'online',
                    application: 'an-application',
                    snapshot: 'an-snapshot',
                    settings: 'some-settings',
                    agentVersion: '1.14.0'
                })
            })

            // Task happens async
            await sleep(100)

            // Should have received update command
            client.received().should.have.length(1)

            const msg = client.received()[0]
            msg.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.applicationDevice.hashid}/command`)
            msg.should.have.property('payload')
            const payload = JSON.parse(msg.payload)
            payload.should.have.property('command', 'update')
            payload.should.have.property('project', null)
            payload.should.have.property('snapshot', null)
        })
    })

    describe('sendCommandAwaitReply', async function () {
        let commsHandler
        let client
        before(function () {
            client = mockSocket()
            commsHandler = DeviceCommsHandler(app, client)
        })
        afterEach(function () {
            client.clearReceived()
        })

        it('Times out command', async function () {
            const start = Date.now()
            return commsHandler.sendCommandAwaitReply(TestObjects.ATeam.hashid, TestObjects.device.hashid, 'command', { a: 123 }, { timeout: 200 }).catch(err => {
                // Expect this to reject
                (Date.now() - start).should.be.approximately(200, 30)
                err.message.should.match(/Command timed out/)
            })
        })

        it('sends command to device and blocks until response received', async function () {
            const commandPromise = commsHandler.sendCommandAwaitReply(TestObjects.ATeam.hashid, TestObjects.device.hashid, 'command', { a: 123 }, { timeout: 200 })
            await sleep(5)
            client.received().should.have.length(1)
            const message = client.received()[0]
            message.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            const payload = JSON.parse(message.payload)
            payload.should.have.property('command', 'command')
            payload.should.have.property('deviceId', TestObjects.device.hashid)
            payload.should.have.property('teamId', TestObjects.ATeam.hashid)
            payload.should.have.property('correlationData')
            payload.should.have.property('createdAt')
            payload.should.have.property('expiresAt')
            payload.should.have.property('responseTopic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/response/test-platform-id`)

            client.emit('response/device', {
                id: TestObjects.device.hashid,
                message: JSON.stringify({
                    command: 'command',
                    correlationData: payload.correlationData,
                    payload: { a: 123 }
                })
            })
            return commandPromise.then(result => {
                result.should.have.property('a', 123)
                return true
            })
        })

        it('sends command to enable device editor', async function () {
            const commandPromise = commsHandler.enableEditor(TestObjects.ATeam.hashid, TestObjects.device.hashid, 'random-token')
            await sleep(5)
            client.received().should.have.length(1)
            const message = client.received()[0]
            message.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            const payload = JSON.parse(message.payload)
            payload.should.have.property('command', 'startEditor')
            payload.should.have.property('deviceId', TestObjects.device.hashid)
            payload.should.have.property('teamId', TestObjects.ATeam.hashid)
            payload.should.have.property('correlationData')
            payload.should.have.property('createdAt')
            payload.should.have.property('expiresAt')
            payload.should.have.property('responseTopic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/response/test-platform-id`)
            payload.should.have.property('payload')
            payload.payload.should.have.property('token', 'random-token')

            client.emit('response/device', {
                id: TestObjects.device.hashid,
                message: JSON.stringify({
                    command: 'startEditor',
                    correlationData: payload.correlationData,
                    payload: { token: payload.token }
                })
            })
            return commandPromise
        })

        it('sends command to disabled device editor without blocking on response', async function () {
            const commandPromise = commsHandler.disableEditor(TestObjects.ATeam.hashid, TestObjects.device.hashid)
            await sleep(5)
            client.received().should.have.length(1)
            const message = client.received()[0]
            message.should.have.property('topic', `ff/v1/${TestObjects.ATeam.hashid}/d/${TestObjects.device.hashid}/command`)
            const payload = JSON.parse(message.payload)
            payload.should.have.property('command', 'stopEditor')
            return commandPromise
        })
    })
})

const should = require('should') // eslint-disable-line

const FF_UTIL = require('flowforge-test-utils')

describe('Check CSP values parsed', async () => {
    let app

    afterEach(async function () {
        await app.close()
    })

    it('CSP Report only should be disabled', async function () {
        const config = {
            content_security_policy: {
                enabled: false
            }
        }
        app = await FF_UTIL.setupApp(config)

        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.not.have.property('content-security-policy-report-only')
        headers.should.not.have.property('content-security-policy')
    })

    it('CSP Report only should be enabled', async function () {
        const config = {
            content_security_policy: {
                enabled: true,
                report_only: true,
                report_uri: 'https://example.com'
            }
        }
        app = await FF_UTIL.setupApp(config)

        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy-report-only')
        const csp = response.headers['content-security-policy-report-only']
        csp.split(';').should.containEql('report-uri https://example.com')
    })

    it('CSP should be enabled', async function () {
        const config = {
            content_security_policy: {
                enabled: true
            }
        }
        app = await FF_UTIL.setupApp(config)
        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy')
        const csp = response.headers['content-security-policy']
        csp.split(';').should.containEql('base-uri \'self\'')
        csp.split(';').should.containEql('script-src \'self\' \'unsafe-inline\' \'unsafe-eval\'')
    })

    it('CSP should be enabled, custom directives', async function () {
        const config = {
            content_security_policy: {
                enabled: true,
                directives: {
                    'base-uri': 'example.com'
                }
            }
        }
        app = await FF_UTIL.setupApp(config)
        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy')
        const csp = response.headers['content-security-policy']
        csp.split(';').should.containEql('base-uri example.com')
    })

    it('CSP should be enabled with plausible', async function () {
        const config = {
            telemetry: {
                frontend: {
                    plausible: {
                        domain: 'example.com'
                    }
                }
            },
            content_security_policy: {
                enabled: true
            }
        }
        app = await FF_UTIL.setupApp(config)
        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy')
        const csp = response.headers['content-security-policy']
        csp.split(';').should.containEql('script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' plausible.io')
    })

    it('CSP should be enabled with posthog', async function () {
        const config = {
            telemetry: {
                frontend: {
                    posthog: {
                        apikey: 'abcde1234'
                    }
                }
            },
            content_security_policy: {
                enabled: true
            }
        }
        app = await FF_UTIL.setupApp(config)
        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy')
        const csp = response.headers['content-security-policy']
        csp.split(';').should.containEql('script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' https://app.posthog.com')
    })

    it('CSP should be enabled with hubspot', async function () {
        const config = {
            support: {
                enabled: true,
                frontend: {
                    hubspot: {
                        trackingcode: 'abcde1234'
                    }
                }
            },
            content_security_policy: {
                enabled: true
            }
        }
        app = await FF_UTIL.setupApp(config)
        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy')
        const csp = response.headers['content-security-policy']
        csp.split(';').should.containEql('script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' js-eu1.hs-analytics.com js-eu1.hs-banner.com js-eu1.hs-scripts.com js-eu1.hscollectedforms.net js-eu1.hubspot.com js-eu1.usemessages.com')
    })

    it('CSP should be enabled with hubspot and posthog', async function () {
        const config = {
            support: {
                enabled: true,
                frontend: {
                    hubspot: {
                        trackingcode: 'abcde1234'
                    }
                }
            },
            telemetry: {
                frontend: {
                    posthog: {
                        apikey: 'abcde1234'
                    }
                }
            },
            content_security_policy: {
                enabled: true
            }
        }
        app = await FF_UTIL.setupApp(config)
        const response = await app.inject({
            method: 'GET',
            url: '/'
        })

        const headers = response.headers
        headers.should.have.property('content-security-policy')
        const csp = response.headers['content-security-policy']
        csp.split(';').should.containEql('script-src \'self\' \'unsafe-inline\' \'unsafe-eval\' https://app.posthog.com js-eu1.hs-analytics.com js-eu1.hs-banner.com js-eu1.hs-scripts.com js-eu1.hscollectedforms.net js-eu1.hubspot.com js-eu1.usemessages.com')
    })
})

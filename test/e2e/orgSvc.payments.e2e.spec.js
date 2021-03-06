var q               = require('q'),
    braintree       = require('braintree'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        orgSvcUrl   : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/account/orgs',
        paymentUrl  : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/payments',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    },
    gateway = braintree.connect({
        environment : braintree.Environment.Sandbox,
        merchantId  : 'ztrphcf283bxgn2f',
        publicKey   : 'rz2pht7gyn6d266b',
        privateKey  : '0a150dac004756370706a195e2bde296'
    });

describe('orgSvc payments (E2E):', function() {
    var cookieJar, readOnlyJar, noCustJar, mockRequester, readOnlyUser, noCustUser, mockCusts, mockOrgs,
        origCard, origPaypal, origJCB, mockApp, appCreds;
    
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        if (cookieJar && readOnlyJar && noCustJar) {
            return done();
        }

        cookieJar = request.jar();
        readOnlyJar = request.jar();
        noCustJar = request.jar();
        mockRequester = {
            id: 'u-e2e-payments',
            status: 'active',
            email: 'requester@c6.com',
            firstName: 'E2E',
            lastName: 'Tests',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-braintree1',
            policies: ['manageAllOrgs']
        };
        readOnlyUser = {
            id: 'u-e2e-readonly',
            status: 'active',
            email : 'read-only@c6.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-otherorg',
            policies: ['readOwnOrg']
        };
        noCustUser = {
            id: 'u-e2e-nocust',
            status: 'active',
            firstName: 'New',
            lastName: 'User',
            email: 'no-cust@c6.com',
            company: 'New Users, Inc.',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-nocust',
            policies: ['manageAllOrgs']
        };
        var testPolicies = [
            {
                id: 'p-e2e-writeOrg',
                name: 'manageAllOrgs',
                status: 'active',
                priority: 1,
                permissions: {
                    campaigns: { read: 'all' },
                    orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                },
                entitlements: {
                    makePayment: true
                }
            },
            {
                id: 'p-e2e-readOrg',
                name: 'readOwnOrg',
                status: 'active',
                priority: 1,
                permissions: {
                    campaigns: { read: 'own' },
                    orgs: { read: 'own' }
                }
            }
        ];
        mockApp = {
            id: 'app-e2e-payments',
            key: 'e2e-payments',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                orgs: { read: 'all' },
                campaigns: { read: 'all' },
                users: { read: 'all' }
            },
            entitlements: {
                makePaymentForAny: true
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var logins = [
            {url: config.authUrl + '/login', json: {email: mockRequester.email, password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: readOnlyUser.email, password: 'password'}, jar: readOnlyJar},
            {url: config.authUrl + '/login', json: {email: noCustUser.email, password: 'password'}, jar: noCustJar},
        ];
        
        q.all([
            testUtils.resetCollection('users', [mockRequester, readOnlyUser, noCustUser]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).then(function(results) {
            results.forEach(function(resp) {
                if (resp.response.statusCode !== 200) {
                    throw new Error('Failed login: ' + resp.response.statusCode + ', ' + util.inspect(resp.body));
                }
            });
            done();
        }).catch(done.fail);
    });
    
    // Setup braintree customers, payment methods, and orgs 
    beforeEach(function(done) {
        if (mockCusts && mockCusts.length > 0) {
            return done();
        }
        
        q.all([
            { company: 'o-braintree1', paymentMethodNonce: 'fake-paypal-future-nonce' },
            { company: 'o-otherorg', paymentMethodNonce: 'fake-valid-jcb-nonce' },
        ].map(function(custCfg) {
            return q.npost(gateway.customer, 'create', [custCfg]);
        })).spread(function(mainOrgResult, otherOrgResult) {
            if (!mainOrgResult.success) {
                return q.reject(mainOrgResult);
            }
            if (!otherOrgResult.success) {
                return q.reject(mainOrgResult);
            }

            mockCusts = [ mainOrgResult.customer, otherOrgResult.customer ];
            origPaypal = mainOrgResult.customer.paymentMethods[0];
            origJCB = otherOrgResult.customer.paymentMethods[0];
            
            return q.npost(gateway.paymentMethod, 'create', [{
                customerId: mainOrgResult.customer.id,
                paymentMethodNonce: 'fake-valid-visa-nonce',
                cardholderName: 'Johnny Testmonkey'
            }]);
        }).then(function(result) {
            if (!result.success) {
                return q.reject(result);
            }
            
            origCard = result.paymentMethod;
            
            mockOrgs = [
                {
                    id: 'o-braintree1',
                    status: 'active',
                    name: 'org w/ cust',
                    braintreeCustomer: mockCusts[0].id
                },
                {
                    id: 'o-otherorg',
                    status: 'active',
                    name: 'other org',
                    braintreeCustomer: mockCusts[1].id
                },
                {
                    id: 'o-nocust',
                    status: 'active',
                    name: 'org w/o cust'
                }
            ];
            
            return testUtils.resetCollection('orgs', mockOrgs);
        }).then(done, done.fail);
    });
    
    describe('GET /api/payments/clientToken', function() {
        var options;
        beforeEach(function() {
            options = { url: config.paymentUrl + '/clientToken', jar: cookieJar };
        });

        it('should get a client token customized for the org', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    clientToken: jasmine.any(String)
                });
                expect(resp.body.clientToken.length).toBeGreaterThan(1);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still get a client token if the org has no braintreeCustomer', function(done) {
            options.jar = noCustJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    clientToken: jasmine.any(String)
                });
                expect(resp.body.clientToken.length).toBeGreaterThan(1);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/payments/', function() {
        var paymentsCreated = false,
            paymentIds, amount1, amount2, amount3, options;
        beforeEach(function(done) {
            options = {
                url: config.paymentUrl + '/',
                qs: {},
                jar: cookieJar
            };
        
            if (paymentsCreated) {
                return done();
            }

            // randomize transaction amounts to avoid duplicate payment rejections when re-running tests
            amount1 = parseFloat(( Math.random() * 10 + 10 ).toFixed(2));
            amount2 = parseFloat(( Math.random() * 10 + 20 ).toFixed(2));
            amount3 = parseFloat(( Math.random() * 10 + 30 ).toFixed(2));

            q.all([
                {
                    amount: String(amount1),
                    paymentMethodToken: origCard.token
                },
                {
                    amount: String(amount2),
                    paymentMethodToken: origCard.token,
                    options: {
                        submitForSettlement: true
                    }
                },
                {
                    amount: String(amount3),
                    paymentMethodToken: origPaypal.token
                }
            ].map(function(cfg) {
                return q.npost(gateway.transaction, 'sale', [cfg]).then(function(result) {
                    if (!result.success) {
                        return q.reject(result);
                    }
                    return q(result);
                });
            })).then(function(results) {
                paymentIds = results.map(function(result) {
                    return result.transaction.id;
                });
                paymentsCreated = true;
            }).then(done, done.fail);
        });
            
        it('should get all payments for an org', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                resp.body.sort(function(a, b) { return parseInt(a.amount) - parseInt(b.amount); });

                var expectedCard = {
                    token: origCard.token,
                    imageUrl: origCard.imageUrl,
                    type: 'creditCard',
                    cardType: 'Visa',
                    cardholderName: 'Johnny Testmonkey',
                    expirationDate: '12/2020',
                    last4: '1881'
                };
                var expectedPaypal = {
                    token: origPaypal.token,
                    imageUrl: origPaypal.imageUrl,
                    type: 'paypal',
                    email: jasmine.any(String),
                };
                expect(resp.body.length).toBe(3);
                expect(resp.body[0]).toEqual({
                    id: paymentIds[0],
                    status: 'authorized',
                    type: 'sale',
                    amount: amount1,
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    method: expectedCard
                });
                expect(resp.body[1]).toEqual({
                    id: paymentIds[1],
                    status: 'submitted_for_settlement',
                    type: 'sale',
                    amount: amount2,
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    method: expectedCard
                });
                expect(resp.body[2]).toEqual({
                    id: paymentIds[2],
                    status: 'authorized',
                    type: 'sale',
                    amount: amount3,
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    method: expectedPaypal
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow filtering by id list', function(done) {
            options.qs.ids = paymentIds[0] + ',' + paymentIds[2];
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                resp.body.sort(function(a, b) { return parseInt(a.amount) - parseInt(b.amount); });
                expect(resp.body[0]).toEqual(jasmine.objectContaining({
                    id: paymentIds[0],
                    status: 'authorized',
                    amount: amount1,
                }));
                expect(resp.body[1]).toEqual(jasmine.objectContaining({
                    id: paymentIds[2],
                    status: 'authorized',
                    amount: amount3
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return 200 and [] for an org with no braintreeCustomer', function(done) {
            options.jar = noCustJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user who can read all orgs to fetch other orgs\' payment methods', function(done) {
            options.qs.org = 'o-otherorg';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent users from fetching payment methods for orgs they cannot see', function(done) {
            options.jar = readOnlyJar;
            options.qs.org = 'o-braintree1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Cannot fetch this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow an app to get payments for an org', function(done) {
            delete options.jar;
            options.qs.org = 'o-braintree1';
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                resp.body.sort(function(a, b) { return parseInt(a.amount) - parseInt(b.amount); });

                expect(resp.body.length).toBe(3);
                expect(resp.body[0]).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    status: 'authorized',
                    amount: amount1
                }));
                expect(resp.body[1]).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    status: 'submitted_for_settlement',
                    amount: amount2
                }));
                expect(resp.body[2]).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    status: 'authorized',
                    amount: amount3
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the app does not provide an org id', function(done) {
            delete options.jar;
            options.qs = {};
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must specify a org id to fetch');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/payments/methods', function() {
        var options;
        beforeEach(function() {
            options = { url: config.paymentUrl + '/methods', jar: cookieJar };
        });
        
        it('should return all of the org\'s payment methods', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                resp.body.sort(function(a, b) { return a.type.localeCompare(b.type); });
                expect(resp.body).toEqual([
                    {
                        token: origCard.token,
                        createdAt: origCard.createdAt,
                        updatedAt: jasmine.any(String),
                        imageUrl: origCard.imageUrl,
                        default: false,
                        type: 'creditCard',
                        cardType: 'Visa',
                        cardholderName: 'Johnny Testmonkey',
                        expirationDate: '12/2020',
                        last4: '1881'
                    },
                    {
                        token: origPaypal.token,
                        createdAt: origPaypal.createdAt,
                        updatedAt: jasmine.any(String),
                        imageUrl: origPaypal.imageUrl,
                        default: true,
                        type: 'paypal',
                        email: 'jane.doe@example.com',
                    }
                ]);
                resp.body.forEach(function(method) {
                    expect(new Date(method.createdAt).toString()).not.toEqual('Invalid Date');
                    expect(new Date(method.updatedAt).toString()).not.toEqual('Invalid Date');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return 200 and [] for an org with no braintreeCustomer', function(done) {
            options.jar = noCustJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user who can read all orgs to fetch other orgs\' payment methods', function(done) {
            options.qs = { org: 'o-otherorg' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([jasmine.objectContaining({
                    token: origJCB.token,
                    createdAt: origJCB.createdAt,
                    updatedAt: jasmine.any(String),
                    imageUrl: origJCB.imageUrl,
                    default: true,
                    type: 'creditCard',
                    cardType: 'JCB',
                    expirationDate: '12/2020',
                    last4: '0000'
                })]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent users from fetching payment methods for orgs they cannot see', function(done) {
            options.jar = readOnlyJar;
            options.qs = { org: 'o-braintree1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Cannot fetch this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get payment methods for an org', function(done) {
            delete options.jar;
            options.qs = { org: 'o-braintree1' };
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                resp.body.sort(function(a, b) { return a.type.localeCompare(b.type); });

                expect(resp.body).toEqual([
                    jasmine.objectContaining({
                        token: origCard.token,
                        imageUrl: origCard.imageUrl,
                        type: 'creditCard',
                        cardType: 'Visa',
                        last4: '1881'
                    }),
                    jasmine.objectContaining({
                        token: origPaypal.token,
                        imageUrl: origPaypal.imageUrl,
                        type: 'paypal',
                        email: 'jane.doe@example.com',
                    })
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the app does not provide an org id', function(done) {
            delete options.jar;
            options.qs = {};
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must specify a org id to fetch');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/payments/methods', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.paymentUrl + '/methods',
                json: {
                    cardholderName: 'Jenny Testmonkey',
                    paymentMethodNonce: 'fake-valid-amex-nonce'
                },
                jar: cookieJar
            };
        });
        
        it('should be able to create a new payment method', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    token: jasmine.any(String),
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    imageUrl: jasmine.any(String),
                    default: false,
                    type: 'creditCard',
                    cardType: 'American Express',
                    cardholderName: 'Jenny Testmonkey',
                    expirationDate: '12/2020',
                    last4: '0005'
                });
                expect(new Date(resp.body.createdAt).toString()).not.toEqual('Invalid Date');
                expect(new Date(resp.body.updatedAt).toString()).not.toEqual('Invalid Date');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to set a new payment method as the default', function(done) {
            options.json.paymentMethodNonce = 'fake-valid-mastercard-nonce';
            options.json.makeDefault = true;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.default).toBe(true);
                expect(resp.body.cardType).toBe('MasterCard');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create a new customer for an org with no braintreeCustomer', function(done) {
            var custId, token;
            options.jar = noCustJar;

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.default).toBe(true);
                expect(resp.body.cardType).toBe('American Express');
                token = resp.body.token;

                // check that braintreeCustomer set on the org
                return requestUtils.qRequest('get', {
                    url: config.orgSvcUrl + '/o-nocust',
                    jar: noCustJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.braintreeCustomer).toEqual(jasmine.any(String));
                custId = resp.body.braintreeCustomer;
                
                return q.npost(gateway.customer, 'find', [custId]);
            }).then(function(cust) {
                expect(cust.id).toBe(custId);
                expect(cust.firstName).toBe('New');
                expect(cust.lastName).toBe('User');
                expect(cust.email).toBe('no-cust@c6.com');
                expect(cust.company).toBe('New Users, Inc.');
                expect(cust.paymentMethods.length).toBe(1);
                expect(cust.paymentMethods[0].token).toBe(token);
                
                // cleanup: delete this new braintree customer
                return q.npost(gateway.customer, 'delete', [custId]);
            }).then(function() {
                // reset orgs
                delete mockOrgs[2].braintreeCustomer;
                return testUtils.resetCollection('orgs', mockOrgs);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the body has no paymentMethodNonce', function(done) {
            delete options.json.paymentMethodNonce;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must include a paymentMethodNonce');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the paymentMethodNonce is invalid', function(done) {
            options.json.paymentMethodNonce = 'evanjustmadethisnonceup';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the paymentMethodNonce has already been consumed', function(done) {
            options.json.paymentMethodNonce = 'fake-consumed-nonce';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the processor declines the card', function(done) {
            options.json.paymentMethodNonce = 'fake-processor-declined-visa-nonce';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Processor declined payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the gateway rejects the nonce', function(done) {
            options.json.paymentMethodNonce = 'fake-luhn-invalid-nonce';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 403 if the user cannot edit their org', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/payments/methods/:token', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.paymentUrl + '/methods/' + origCard.token,
                json: {
                    paymentMethodNonce: 'fake-valid-discover-nonce',
                    cardholderName: 'Johnny Testmonkey Jr.'
                },
                jar: cookieJar
            };
        });
        
        it('should be able to edit a card with new details', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    token: origCard.token,
                    createdAt: origCard.createdAt,
                    updatedAt: jasmine.any(String),
                    imageUrl: jasmine.any(String),
                    default: false,
                    type: 'creditCard',
                    cardType: 'Discover',
                    cardholderName: 'Johnny Testmonkey Jr.',
                    expirationDate: '12/2020',
                    last4: '1117'
                });
                expect(new Date(resp.body.updatedAt)).toBeGreaterThan(new Date(origCard.updatedAt));
                expect(resp.body.imageUrl).not.toEqual(origCard.imageUrl);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to switch which method is the default', function(done) {
            options.json = { makeDefault: true };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.token).toEqual(origCard.token);
                expect(resp.body.cardholderName).toBe('Johnny Testmonkey Jr.');
                expect(resp.body.default).toBe(true);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the body has no paymentMethodNonce', function(done) {
            delete options.json.paymentMethodNonce;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must include a paymentMethodNonce');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the paymentMethodNonce is invalid', function(done) {
            options.json.paymentMethodNonce = 'evanjustmadethisnonceup';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the paymentMethodNonce has already been consumed', function(done) {
            options.json.paymentMethodNonce = 'fake-consumed-nonce';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the processor declines the card', function(done) {
            options.json.paymentMethodNonce = 'fake-processor-declined-visa-nonce';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Processor declined payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the gateway rejects the nonce', function(done) {
            options.json.paymentMethodNonce = 'fake-luhn-invalid-nonce';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the payment method does not exist', function(done) {
            options.url = config.paymentUrl + '/method/evanmadeupthistoken';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That payment method does not exist for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org has no braintreeCustomer', function(done) {
            options.jar = noCustJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No payment methods for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 if the user cannot edit their org', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow a user to edit a paymentMethod they do not own', function(done) {
            options.url = config.paymentUrl + '/methods/' + origJCB.token;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That payment method does not exist for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/payments/methods/:token', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.paymentUrl + '/methods/' + origCard.token,
                jar: cookieJar
            };
        });
        
        it('should be able to delete a payment method', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                return q.npost(gateway.paymentMethod, 'find', [origCard.token])
                .then(function(method) {
                    expect(method).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.name).toBe('notFoundError');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the method has already been deleted', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the payment method does not exist', function(done) {
            options.url = config.paymentUrl + '/method/evanmadeupthistoken';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org has no braintreeCustomer', function(done) {
            options.jar = noCustJar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No payment methods for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 if the user cannot edit their org', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the payment method exists for another org', function(done) {
            options.url = config.paymentUrl + '/methods/' + origJCB.token;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('POST /api/payments', function() {
        var options, amount, expectedMethodOutput, mockman, newCard;

        // setup a new credit card, as duplicate transaction checking doesn't work for paypal
        beforeEach(function(done) {
            if (!!newCard) {
                return done();
            }

            return q.npost(gateway.paymentMethod, 'create', [{
                customerId: mockCusts[0].id,
                paymentMethodNonce: 'fake-valid-amex-nonce',
                cardholderName: 'Big Spender'
            }]).then(function(result) {
                if (!result.success) {
                    return q.reject(result);
                }
                
                newCard = result.paymentMethod;
            }).then(done, done.fail);
        });
        
        beforeEach(function(done) {
            // randomize transaction amounts to avoid duplicate payment rejections when re-running tests
            amount = parseFloat(( Math.random() * 100 + 100 ).toFixed(2));
            options = {
                url: config.paymentUrl,
                json: {
                    amount: parseFloat(amount),
                    paymentMethod: newCard.token
                },
                jar: cookieJar
            };

            expectedMethodOutput = jasmine.objectContaining({
                token: newCard.token,
                imageUrl: newCard.imageUrl,
                type: 'creditCard'
            });
            
            mockman = new testUtils.Mockman();
            mockman.start().then(function() {
                testUtils.resetPGTable('fct.billing_transactions').then(done, done.fail);
            });
        });
        
        afterEach(function() {
            mockman.removeAllListeners();
        });
        
        it('should create a braintree transaction + a credit transaction in our db', function(done) {
            var createdTransaction;

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'submitted_for_settlement',
                    type: 'sale',
                    amount: amount,
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    method: expectedMethodOutput
                });
                createdTransaction = resp.body;
                
                return testUtils.pgQuery('SELECT * FROM fct.billing_transactions WHERE braintree_id = $1', [resp.body.id]);
            }).then(function(results) {
                expect(results.rows.length).toBe(1);
                expect(results.rows[0]).toEqual(jasmine.objectContaining({
                    rec_key         : jasmine.any(String),
                    rec_ts          : jasmine.any(Date),
                    transaction_id  : jasmine.any(String),
                    transaction_ts  : results.rows[0].rec_ts,
                    org_id          : 'o-braintree1',
                    amount          : amount.toFixed(4),
                    sign            : 1,
                    units           : 1,
                    campaign_id     : null,
                    braintree_id    : createdTransaction.id,
                    promotion_id    : null,
                    description     : JSON.stringify({ eventType: 'credit', source: 'braintree' }),
                    view_target     : null,
                    cycle_end       : null,
                    cycle_start     : null,
                    paymentplan_id  : null,
                    application     : 'selfie'
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mockman.on('paymentMade', function(record) {
                expect(record.data.balance).toBe(amount);
                expect(record.data.payment).toEqual(createdTransaction);
                expect(record.data.user).toEqual(jasmine.objectContaining({
                    id: 'u-e2e-payments',
                    status: 'active',
                    email: 'requester@c6.com',
                }));
                expect(record.data.user.password).not.toBeDefined();
                done();
            });
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'submitted_for_settlement',
                    type: 'sale',
                    amount: amount,
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    method: expectedMethodOutput
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });

            mockman.on('paymentMade', function(record) {
                done();
            });
        });

        it('should support the singular version of the endpoint', function(done) {
            options.url = config.paymentUrl.replace('payments', 'payment');
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', { service: 'orgSvc', 'data.route': /^POST/ }, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-e2e-payments');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/payment/',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });

            mockman.on('paymentMade', function(record) {
                done();
            });
        });
        
        it('should allow setting additional props on the transaction', function(done) {
            var cycleEnd = new Date(Date.now() + 5*60*60*1000),
                cycleStart = new Date(Date.now() + 1*60*60*1000);

            options.json.transaction = {
                description: JSON.stringify({ source: 'wealthy benefactor' }),
                targetUsers: 9001,
                cycleEnd: cycleEnd,
                cycleStart: cycleStart,
                paymentPlanId: 'pp-faaake',
                application: 'proshop'
            };
            var createdTransaction;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    amount: amount,
                    method: expectedMethodOutput
                }));
                createdTransaction = resp.body;
                
                return testUtils.pgQuery('SELECT * FROM fct.billing_transactions WHERE braintree_id = $1', [resp.body.id]);
            }).then(function(results) {
                expect(results.rows.length).toBe(1);
                expect(results.rows[0]).toEqual(jasmine.objectContaining({
                    org_id          : 'o-braintree1',
                    amount          : amount.toFixed(4),
                    sign            : 1,
                    description     : JSON.stringify({ source: 'wealthy benefactor' }),
                    view_target     : 9001,
                    cycle_end       : cycleEnd,
                    cycle_start     : cycleStart,
                    paymentplan_id  : 'pp-faaake',
                    application     : 'proshop'
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mockman.on('paymentMade', function(record) {
                done();
            });
        });

        it('should fail if the description is too long', function(done) {
            options.json.transaction = {
                description: new Array(1000).join(',').split(',').map(function() { return 'a'; }).join('')
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('transaction.description must have at most 255 characters');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        //TODO: remove this test once deprecated functionality is removed
        it('should allow setting the description on the top-level of the body', function(done) {
            options.json.description = JSON.stringify({ source: 'wealthy benefactor' });
            var createdTransaction;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    amount: amount,
                    method: expectedMethodOutput
                }));
                createdTransaction = resp.body;
                
                return testUtils.pgQuery('SELECT * FROM fct.billing_transactions WHERE braintree_id = $1', [resp.body.id]);
            }).then(function(results) {
                expect(results.rows.length).toBe(1);
                expect(results.rows[0].description).toBe(JSON.stringify({ source: 'wealthy benefactor' }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mockman.on('paymentMade', function(record) {
                done();
            });
        });
        
        it('should fail on duplicate transactions', function(done) {
            q.all([
                requestUtils.qRequest('post', options),
                requestUtils.qRequest('post', options)
            ]).then(function(results) {
                // handle potential timing conflicts - just care that 1 response succeeds + 1 fails
                results.sort(function(a, b) { return a.response.statusCode - b.response.statusCode; });
                expect(results[0].response.statusCode).toBe(201);
                expect(results[0].body).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    status: 'submitted_for_settlement',
                    amount: amount
                }));
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toEqual('Gateway Rejected: duplicate');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mockman.on('paymentMade', function(record) {
                done();
            });
        });
        
        it('should return a 400 if the body is missing a required parameter', function(done) {
            q.all([{ amount: amount }, { paymentMethod: origCard.token }].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('Missing required field: paymentMethod');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('Missing required field: amount');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should return a 400 if the amount is too small', function(done) {
            q.all([-123, 0, 0.23].map(function(smallAmount) {
                options.json.amount = smallAmount;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toMatch(/amount must be greater than the min: \d+/);
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should return a 400 if the payment method does not exist', function(done) {
            options.json.paymentMethod = 'infinite money';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That payment method does not exist for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should return a 403 if the user does not have permission to make payments', function(done) {
            options.jar = readOnlyJar;
            options.json.paymentMethod = origJCB.token;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should not allow a user to post a payment with a paymentMethod they do not own', function(done) {
            options.qs = { org: 'o-otherorg' };
            options.json.paymentMethod = origJCB.token;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Cannot make payment for another org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should return a 400 if the org has no braintreeCustomer', function(done) {
            options.jar = noCustJar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No payment methods for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should return a 401 if no user is logged in', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);

            mockman.on('paymentMade', function(record) {
                expect(record).not.toBeDefined();
            });
        });
        
        it('should allow an app to post a payment for an org', function(done) {
            var createdTransaction;
            delete options.jar;
            options.qs = { org: 'o-braintree1' };
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'submitted_for_settlement',
                    type: 'sale',
                    amount: amount,
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    method: expectedMethodOutput
                });
                createdTransaction = resp.body;
                
                return testUtils.pgQuery('SELECT * FROM fct.billing_transactions WHERE braintree_id = $1', [resp.body.id]);
            }).then(function(results) {
                expect(results.rows.length).toBe(1);
                expect(results.rows[0]).toEqual(jasmine.objectContaining({
                    rec_key         : jasmine.any(String),
                    rec_ts          : jasmine.any(Date),
                    transaction_id  : jasmine.any(String),
                    transaction_ts  : results.rows[0].rec_ts,
                    org_id          : 'o-braintree1',
                    amount          : amount.toFixed(4),
                    sign            : 1,
                    units           : 1,
                    campaign_id     : null,
                    braintree_id    : createdTransaction.id,
                    promotion_id    : null,
                    description     : JSON.stringify({ eventType: 'credit', source: 'braintree' }),
                    view_target     : null,
                    cycle_end       : null,
                    cycle_start     : null,
                    paymentplan_id  : null,
                    application     : 'selfie'
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mockman.on('paymentMade', function(record) {
                expect(record.data.balance).toBe(amount);
                expect(record.data.payment).toEqual(createdTransaction);
                expect(record.data.user).toEqual(jasmine.objectContaining({
                    id: 'u-e2e-payments',
                    status: 'active',
                    email: 'requester@c6.com',
                }));
                expect(record.data.user.password).not.toBeDefined();
                done();
            });
        });
        
        afterAll(function() {
            mockman.stop();
        });
    });
        
    afterAll(function(done) {
        q.all(mockCusts.map(function(cust) {
            return q.npost(gateway.customer, 'delete', [cust.id]);
        })).then(function() {
            return testUtils.closeDbs();
        }).then(done, done.fail);
    });
});

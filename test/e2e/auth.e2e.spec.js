var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    config      = {
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/auth',
        maintUrl    : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint'
    };

jasmine.getEnv().defaultTimeoutInterval = 5000;

describe('auth (E2E)', function() {
    var testNum = 0;
    
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'auth.log'
            }
        };
        testUtils.qRequest('post', [options])
        .catch(function(error) {
            console.log("Error clearing auth log: " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('auth.log', config.maintUrl, jasmine.getEnv().currentSpec, 'auth', ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    
    describe('/auth/login', function() {
        var mockUser,
            now = new Date();
        
        beforeEach(function(done) {
            mockUser = {
                id : "u-1234567890abcd",
                created : now,
                username : "johnnyTestmonkey",
                password : "$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq" // hash of 'password'
            };
            
            var options = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "users",
                    data: mockUser
                }
            };
            testUtils.qRequest('post', options).done(function(resp) {
                done();
            });
        });
        
        it('should succeed given valid credentials', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'johnnyTestmonkey',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBe("u-1234567890abcd");
                expect(resp.body.user.username).toBe("johnnyTestmonkey");
                expect(resp.body.user.password).not.toBeDefined();
                expect(new Date(resp.body.user.created)).toEqual(now);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail for an invalid username', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'randomUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe("Invalid username or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail for an invalid password', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'johnnyTestmonkey',
                    password: 'notpassword'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe("Invalid username or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if not given both a username and password', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'johnnyTestmonkey'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                delete options.json.username;
                options.json.password = 'password';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/auth/signup', function() {
        var mockUser;
        beforeEach(function() {
            mockUser = {
                username: 'johnnyTestmonkey',
                password: 'password'
            };
        });
        
        it('should succeed given valid credentials', function(done) {
            var resetOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "users"
                }
            };
            testUtils.qRequest('post', resetOpts).then(function(resp) {
                var options = {
                    url: config.authUrl + '/signup',
                    json: mockUser
                };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBeDefined();
                expect(resp.body.user.username).toBe("johnnyTestmonkey");
                expect(resp.body.user.password).not.toBeDefined();
                expect(resp.body.user.created).toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if given a username already tied to an account', function(done) {
            var resetOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "users",
                    data: mockUser
                }
            };
            testUtils.qRequest('post', resetOpts).then(function(resp) {
                var options = {
                    url: config.authUrl + '/signup',
                    json: mockUser
                };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('A user with that username already exists');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if not given both a username and password', function(done) {
            var options = {
                url: config.authUrl + '/signup',
                json: {
                    username: 'johnnyTestmonkey'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                delete options.json.username;
                options.json.password = 'password';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
});

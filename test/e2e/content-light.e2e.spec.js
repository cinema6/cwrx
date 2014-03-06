var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api/content',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('content-light (E2E):', function() {
    describe('content CRUD: ', function() {
        var cookieJar = require('request').jar(),
            origExp = {
                title: "origTitle",
                status: "inactive",
                e2e: true
            },
            testUser = {
                username: "content-lightE2EUser",
                password: "password",
                e2e: true
            },
            currExp;
        
        it('create a test user', function(done) {
            var options = {
                url: config.authUrl + '/signup',
                jar: cookieJar,
                json: testUser
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.body.user).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('create an experience', function(done) {
            var options = {
                url: config.contentUrl + '/experience',
                jar: cookieJar,
                json: origExp
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                currExp = resp.body;
                expect(currExp).toBeDefined();
                expect(currExp.id).toBeDefined();
                expect(currExp.title).toBe("origTitle");
                expect(currExp.status).toBe("inactive");
                expect(currExp.e2e).toBe(true);
                expect(currExp.created).toBeDefined();
                expect(currExp.lastUpdated).toBeDefined();
                expect(currExp.user).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('retrieve an experience', function(done) {
            var options = {
                url: config.contentUrl + '/experience/' + currExp.id,
                jar: cookieJar,
                json: origExp
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(currExp);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('update an experience', function(done) {
            Object.keys(currExp).forEach(function(key) {
                origExp[key] = currExp[key];
            });
            var options = {
                url: config.contentUrl + '/experience/' + currExp.id,
                jar: cookieJar,
                json: { title: 'newTitle' }
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body).not.toEqual(origExp);
                expect(resp.body.title).toBe('newTitle');
                expect(resp.body.id).toBe(origExp.id);
                expect(resp.body.created).toBe(origExp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(origExp.lastUpdated));
                currExp = resp.body;
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('delete an experience', function(done) {
            var options = {
                url: config.contentUrl + '/experience/' + currExp.id,
                jar: cookieJar
            };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('delete the test user', function(done) {
            var options = {
                url: config.authUrl + '/delete_account',
                jar: cookieJar
            };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Successfully deleted account");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });

    describe('/api/content/meta', function() {
        it('should print out appropriate metadata about the content service', function(done) {
            var options = {
                url: config.contentUrl + '/meta'
            };
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
                expect(resp.body.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
                expect(resp.body.started).toBeDefined();
                expect(new Date(resp.body.started).toString()).not.toEqual('Invalid Date');
                expect(resp.body.status).toBe("OK");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });  // end -- describe /api/content/meta
});  // end -- describe content (E2E)

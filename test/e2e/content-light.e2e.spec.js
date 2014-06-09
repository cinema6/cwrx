var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('content-light (E2E):', function() {
    describe('content CRUD: ', function() {
        var cookieJar = require('request').jar(),
            origExp = {
                title: "origTitle",
                status: "inactive",
                data: { foo: 'bar' },
                org: 'e2e-org',
                e2e: true
            },
            testUser = {
                email: 'johnnyTestmonkey@cinema6.com',
                password: 'bananas4bananas'
            },
            currExp;
        
        it('login the e2e test user', function(done) {
            var options = {
                url: config.authUrl + '/auth/login',
                jar: cookieJar,
                json: testUser
            };
            testUtils.qRequest('post', options).done(function(resp) {
                if (resp.response.statusCode !== 200) {
                    console.log('Could not log in the test user');
                    console.log('Double check that the user johnnyTestmonkey@cinema6.com exists in the database');
                    return q.reject('Received response: code = ' + resp.response.statusCode +
                                    ', body = ' + resp.body);
                }
                done();
            }, function(error) {
                console.log('Could not log in the test user: ' + error);
                throw new Error('Error logging in the test user; failing');
                done();
            });
        });
        
        it('create an experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience',
                jar: cookieJar,
                json: origExp
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                currExp = resp.body;
                expect(currExp).toBeDefined();
                expect(currExp._id).not.toBeDefined();
                expect(currExp.id).toBeDefined();
                expect(currExp.title).toBe("origTitle");
                expect(currExp.status).toBe("inactive");
                expect(currExp.e2e).toBe(true);
                expect(currExp.data).toEqual({foo: 'bar'});
                expect(currExp.versionId).toBe('a5e744d0');
                expect(currExp.created).toBeDefined();
                expect(currExp.lastUpdated).toBeDefined();
                expect(currExp.user).toBeDefined();
                expect(currExp.org).toBe('e2e-org');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('retrieve an experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/' + currExp.id,
                jar: cookieJar
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
                url: config.contentUrl + '/content/experience/' + currExp.id,
                jar: cookieJar,
                json: { tag: 'newTag', data: { blah: 'bloop' }, status: 'active' }
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body).not.toEqual(origExp);
                expect(resp.body.tag).toBe('newTag');
                expect(resp.body.data).toEqual({blah: 'bloop'});
                expect(resp.body.versionId).toBe('bdca8616');
                expect(resp.body.versionId).not.toBe(origExp.versionId);
                expect(resp.body.id).toBe(origExp.id);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.created).toBe(origExp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(origExp.lastUpdated));
                currExp = resp.body;
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('retrieve a public experience', function(done) {
            var options = {
                url: config.contentUrl + '/public/content/experience/' + currExp.id
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var expCopy = JSON.parse(JSON.stringify(currExp));
                delete expCopy.user, delete expCopy.org;
                expect(resp.body).toEqual(expCopy);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('delete an experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/' + currExp.id,
                jar: cookieJar
            };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('logout the e2e test user', function(done) {
            var options = {
                url: config.authUrl + '/auth/logout',
                jar: cookieJar
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('/api/content/meta', function() {
        it('should print out appropriate metadata about the content service', function(done) {
            var options = {
                url: config.contentUrl + '/content/meta'
            };
            testUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
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

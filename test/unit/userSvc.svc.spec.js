var flush = true;
describe('userSvc (UT)', function() {
    var mockLog, mockLogger, req, uuid, logger, bcrypt, userSvc, q, QueryCache, mongoUtils,
        FieldValidator, enums, Status, Scope;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        bcrypt          = require('bcrypt');
        userSvc         = require('../../bin/userSvc');
        QueryCache      = require('../../lib/queryCache');
        FieldValidator  = require('../../lib/fieldValidator');
        mongoUtils      = require('../../lib/mongoUtils');
        email           = require('../../lib/email');
        q               = require('q');
        enums           = require('../../lib/enums');
        Status          = enums.Status;
        Scope           = enums.Scope;
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        req = {uuid: '1234'};
    });
    
    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    users: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var users = [{ id: 'u-1234', org: 'o-1234'},
                         { id: 'u-4567', org: 'o-1234'},
                         { id: 'u-1234', org: 'o-4567'},
                         { id: 'u-4567', org: 'o-4567'}];
            
            expect(users.filter(function(target) {
                return userSvc.checkScope(requester, target, 'read');
            })).toEqual(users);
            expect(users.filter(function(target) {
                return userSvc.checkScope(requester, target, 'edit');
            })).toEqual([users[0], users[1], users[2]]);
            expect(users.filter(function(target) {
                return userSvc.checkScope(requester, target, 'delete');
            })).toEqual([users[0], users[2]]);
        });
    
        it('should sanity-check the user permissions object', function() {
            var target = { id: 'u-1' };
            expect(userSvc.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users = {};
            requester.permissions.orgs = { read: Scope.All };
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = '';
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = Scope.All;
            expect(userSvc.checkScope(requester, target, 'read')).toBe(true);
        });
    });
    
    describe('permsCheck', function() {
        var updates, orig, requester;
        beforeEach(function() {
            updates = { permissions: { users: {} } };
            orig = { id: 'u-2' };
            requester = {
                id: 'u-1',
                permissions: {
                    users: {
                        read: Scope.Own,
                        create: Scope.Org,
                        edit: Scope.All
                    }
                }
            };
        });
        
        it('should return false if the requester has no perms', function() {
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(true);
            delete requester.permissions;
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
        });
        
        it('should return false if the requester is trying to change their own perms', function() {
            orig.id = 'u-1';
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
        });
        
        it('should return false if the updates\' perms exceed the requester\'s', function() {
            updates.permissions.users = { read: Scope.Org };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { read: Scope.All };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { create: Scope.All };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { edit: Scope.All };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(true);
            updates.permissions.users = { delete: Scope.Own };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { read: Scope.Own, create: Scope.Own, edit: Scope.Own };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(true);
            updates.permissions = { experiences: { read: Scope.Own } };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(userSvc.createValidator._forbidden).toEqual(['id', 'created']);
            expect(typeof userSvc.createValidator._condForbidden.org).toBe('function');
        });
        
        it('should prevent setting forbidden fields', function() {
            var updates = { a: 'b' };
            expect(userSvc.createValidator.validate(updates, {}, {})).toBe(true);
            var updates = { a: 'b', id: 'foo' };
            expect(userSvc.createValidator.validate(updates, {}, {})).toBe(false);
            var updates = { a: 'b', created: 'foo' };
            expect(userSvc.createValidator.validate(updates, {}, {})).toBe(false);
        });
        
        it('should conditionally prevent setting the org field', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    users: { create: Scope.Org }
                }
            };
            var user = { a: 'b', org: 'o-1234' };
            spyOn(FieldValidator, 'eqReqFieldFunc').andCallThrough();
            spyOn(FieldValidator, 'scopeFunc').andCallThrough();
            
            expect(userSvc.createValidator.validate(user, {}, requester)).toBe(true);
            expect(FieldValidator.eqReqFieldFunc).toHaveBeenCalledWith('org');
            expect(FieldValidator.scopeFunc).toHaveBeenCalledWith('users', 'create', Scope.All);
            
            user.org = 'o-4567';
            expect(userSvc.createValidator.validate(user, {}, requester)).toBe(false);
            requester.permissions.users.create = Scope.All;
            expect(userSvc.createValidator.validate(user, {}, requester)).toBe(true);
        });
        
        it('should conditionally prevent setting the permissions', function() {
            spyOn(userSvc, 'permsCheck').andReturn(true);
            userSvc.createValidator._condForbidden.permissions = userSvc.permsCheck;
            var user = { a: 'b', permissions: 'foo' };
            expect(userSvc.createValidator.validate(user, {}, {})).toBe(true);
            userSvc.permsCheck.andReturn(false);
            expect(userSvc.createValidator.validate(user, {}, {})).toBe(false);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initialized correctly', function() {
            expect(userSvc.updateValidator._forbidden).toEqual(['id', 'org', 'password', 'created', '_id', 'email']);
            expect(userSvc.updateValidator._condForbidden.permissions).toBe(userSvc.permsCheck);
        });
        
        it('should prevent illegal updates', function() {
            spyOn(userSvc, 'permsCheck').andReturn(true);
            userSvc.updateValidator._condForbidden.permissions = userSvc.permsCheck;
            var updates = { a: 'b', permissions: 'foo' };
            expect(userSvc.updateValidator.validate(updates, {}, {})).toBe(true);
            updates = { a: 'b', id: 'u-4567', permissions: 'foo' };
            expect(userSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', org: 'o-4567', permissions: 'foo' };
            expect(userSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', password: 'bad password', permissions: 'foo' };
            expect(userSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', created: 'long, long ago', permissions: 'foo' };
            expect(userSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', permissions: 'foo' };
            userSvc.permsCheck.andReturn(false);
            expect(userSvc.updateValidator.validate(updates, {}, {})).toBe(false);
        });
    });
    
    describe('getUsers', function() {
        var cache, query, userColl, fakeCursor;
        beforeEach(function() {
            req.user = { id: 'u-1234' };
            req.query = {
                sort: 'id,1',
                limit: 20,
                skip: 10
            };
            query = { org: 'o-1234' };
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, q([ {id: '1'}, {id: '2'} ]));
                })
            };
            userColl = {
                find: jasmine.createSpy('users.find').andReturn(fakeCursor)
            };
            spyOn(userSvc, 'checkScope').andReturn(true);
            spyOn(mongoUtils, 'safeUser').andCallThrough();
        });
        
        it('should call users.find to get users', function(done) {
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}, {id:'2'}]);
                expect(userColl.find).toHaveBeenCalledWith({org: 'o-1234'},
                                                           {sort: {id: 1}, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(userSvc.checkScope.calls.length).toBe(2);
                expect(userSvc.checkScope.calls[0].args).toEqual([{id: 'u-1234'}, {id:'1'}, 'read']);
                expect(userSvc.checkScope.calls[1].args).toEqual([{id: 'u-1234'}, {id:'2'}, 'read']);
                expect(mongoUtils.safeUser.calls.length).toBe(2);
                expect(mongoUtils.safeUser.calls[0].args[0]).toEqual({id:'1'});
                expect(mongoUtils.safeUser.calls[1].args[0]).toEqual({id:'2'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should use defaults for sorting/paginating options if not provided', function(done) {
            req.query = { org: 'o-1234' };
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}, {id:'2'}]);
                expect(userColl.find).toHaveBeenCalledWith({org: 'o-1234'},
                                                           {sort: {}, limit: 0, skip: 0});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(mongoUtils.safeUser.calls.length).toBe(2);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should only show users the requester is allowed to see', function(done) {
            userSvc.checkScope.andCallFake(function(requester, target, verb) {
                if (target.id === '1') return false;
                else return true;
            });
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'2'}]);
                expect(userColl.find).toHaveBeenCalled();
                expect(userSvc.checkScope.calls.length).toBe(2);
                expect(userSvc.checkScope.calls[0].args).toEqual([{id: 'u-1234'}, {id:'1'}, 'read']);
                expect(userSvc.checkScope.calls[1].args).toEqual([{id: 'u-1234'}, {id:'2'}, 'read']);
                expect(mongoUtils.safeUser.calls.length).toBe(1);
                expect(mongoUtils.safeUser.calls[0].args[0]).toEqual({id:'2'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not show any deleted users', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, q([{id: '1', status: Status.Deleted}]));
            })
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No users found');
                expect(userColl.find).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, []);
            });
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No users found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the promise was rejected', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb('Error!');
            });
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(userColl.find).toHaveBeenCalledWith({org: 'o-1234'},
                                                           {sort: { id: 1 }, limit: 20, skip: 10});
                expect(userSvc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            userSvc.getUsers(query, req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}, {id:'2'}]);
                expect(mockLog.warn).toHaveBeenCalled();
                expect(userColl.find).toHaveBeenCalledWith({org: 'o-1234'},
                                                           {sort: {}, limit: 20, skip: 10});
                expect(mongoUtils.safeUser.calls.length).toBe(2);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('setupUser', function() {
        var newUser, requester;
        beforeEach(function() {
            newUser = { email: 'testUser', password: 'pass' };
            requester = { id: 'u-4567', org: 'o-1234' };
            spyOn(bcrypt, 'hash').andCallFake(function(password, salt, cb) {
                cb(null, 'fakeHash');
            });
            spyOn(bcrypt, 'genSaltSync').andReturn('sodiumChloride');
            spyOn(uuid, 'createUuid').andReturn('1234567890abcdefg');
        });

        it('should set some default fields and hash the user\'s password', function(done) {
            userSvc.setupUser(newUser, requester).then(function() {
                expect(newUser.id).toBe('u-1234567890abcd');
                expect(newUser.email).toBe('testUser');
                expect(newUser.created instanceof Date).toBeTruthy('created is a Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.applications).toEqual(['e-51ae37625cb57f']);
                expect(newUser.org).toBe('o-1234');
                expect(newUser.status).toBe(Status.Active);
                expect(newUser.permissions).toEqual({
                    experiences: { read: Scope.Org, create: Scope.Org, edit: Scope.Org, delete: Scope.Org },
                    elections: { read: Scope.Org, create: Scope.Org, edit: Scope.Org, delete: Scope.Org },
                    users: { read: Scope.Own, edit: Scope.Own },
                    orgs: { read: Scope.Own }
                });
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(bcrypt.hash.calls[0].args[0]).toBe('pass');
                expect(bcrypt.hash.calls[0].args[1]).toBe('sodiumChloride');
                expect(newUser.password).toBe('fakeHash');
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should intelligently merge the newUser fields with defaults', function(done) {
            newUser.org = 'o-4567';
            newUser.status = Status.Pending;
            newUser.permissions = {
                experiences: { read: Scope.All, create: Scope.Own },
                users: { read: Scope.Org, delete: Scope.Own }
            };
            userSvc.setupUser(newUser, requester).then(function() {
                expect(newUser.id).toBe('u-1234567890abcd');
                expect(newUser.email).toBe('testUser');
                expect(newUser.created instanceof Date).toBeTruthy('created is a Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.org).toBe('o-4567');
                expect(newUser.status).toBe(Status.Pending);
                expect(newUser.permissions).toEqual({
                    elections: { read: Scope.Org, create: Scope.Org, edit: Scope.Org, delete: Scope.Org },
                    experiences: { read: Scope.All, create: Scope.Own, edit: Scope.Org, delete: Scope.Org },
                    users: { read: Scope.Org, edit: Scope.Own, delete: Scope.Own },
                    orgs: { read: Scope.Own }
                });
                expect(newUser.password).toBe('fakeHash');
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if hashing the password fails', function(done) {
            bcrypt.hash.andReturn(q.reject('Error!'));
            userSvc.setupUser(newUser, requester).then(function() {
                expect(true).toBeFalsy('you should not be here!');
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                done();
            });
        });
    });
    
    describe('createUser', function() {
        var userColl;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, null);
                }),
                insert: jasmine.createSpy('users.insert').andCallFake(function(obj, opts, cb) {
                    cb();
                })
            };
            req.body = { email: 'test', password: 'pass'};
            req.user = { id: 'u-1234', org: 'o-1234' };
            spyOn(userSvc, 'setupUser').andCallFake(function(target, requester) {
                target.password = 'hashPass';
                if (!target.org) target.org = requester.org;
                return q();
            });
            spyOn(mongoUtils, 'safeUser').andCallThrough();
            spyOn(userSvc.createValidator, 'validate').andReturn(true);
        });
        
        it('should reject with a 400 if no user object is provided', function(done) {
            delete req.body;
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('You must provide an object in the body');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });            
        });
        
        it('should reject with a 400 if the email or password are unspecified', function(done) {
            delete req.body.email;
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('New user object must have a email and password');
                req.body = { email: 'test' };
                return userSvc.createUser(req, userColl);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('New user object must have a email and password');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with a 409 if the user already exists', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb(null, { id: 'u-4567', email: 'test' });
            });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(409);
                expect(resp.body).toEqual('A user with that email already exists');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should successfully create a new user', function(done) {
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({email: 'test', org: 'o-1234'});
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({email: 'test'});
                expect(userSvc.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(userSvc.setupUser).toHaveBeenCalledWith(req.body, req.user);
                expect(userColl.insert).toHaveBeenCalled();
                expect(userColl.insert.calls[0].args[0]).toBe(req.body);
                expect(userColl.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(mongoUtils.safeUser)
                    .toHaveBeenCalledWith({email: 'test', org: 'o-1234', password: 'hashPass'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with a 400 if the new user contains illegal fields', function(done) {
            userSvc.createValidator.validate.andReturn(false);
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Illegal fields');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.createValidator.validate).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should allow an admin to create users in a different org', function(done) {
            req.body.org = 'o-4567';
            req.user.permissions = { users: { create: Scope.All } };
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({email: 'test', org: 'o-4567'});
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).toHaveBeenCalled();
                expect(mongoUtils.safeUser)
                    .toHaveBeenCalledWith({email: 'test', org: 'o-4567', password: 'hashPass'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should fail with an error if finding the existing user fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if setting up the user fails', function(done) {
            userSvc.setupUser.andReturn(q.reject('Error!'));
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userSvc.setupUser).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if inserting the user fails', function(done) {
            userColl.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.insert).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('updateUser', function() {
        var userColl;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, {orig: 'yes'});
                }),
                findAndModify: jasmine.createSpy('users.findAndModify').andCallFake(
                    function(query, sort, obj, opts, cb) {
                        cb(null, [{ id: 'u-4567', updated: true }]);
                    })
            };
            req.body = { foo: 'bar' };
            req.params = { id: 'u-4567' };
            req.user = { id: 'u-1234' };
            spyOn(userSvc, 'checkScope').andReturn(true);
            spyOn(mongoUtils, 'safeUser').andCallThrough();
            spyOn(userSvc.updateValidator, 'validate').andReturn(true);
        });
        
        it('should fail immediately if no update object is provided', function(done) {
            delete req.body;
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You must provide an object in the body');
                req.body = 'foo';
                return userSvc.updateUser(req, userColl);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBeDefined(400);
                expect(resp.body).toBe('You must provide an object in the body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully update a user', function(done) {
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'u-4567', updated: true });
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({id: 'u-4567'});
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, {orig: 'yes'}, 'edit');
                expect(userSvc.updateValidator.validate)
                    .toHaveBeenCalledWith(req.body, {orig: 'yes'}, {id: 'u-1234'});
                expect(userColl.findAndModify).toHaveBeenCalled();
                expect(userColl.findAndModify.calls[0].args[0]).toEqual({id: 'u-4567'});
                expect(userColl.findAndModify.calls[0].args[1]).toEqual({id: 1});
                var updates = userColl.findAndModify.calls[0].args[2];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.foo).toBe('bar');
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(userColl.findAndModify.calls[0].args[3]).toEqual({w:1,journal:true,new:true});
                expect(mongoUtils.safeUser).toHaveBeenCalledWith({ id: 'u-4567', updated: true });
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not create a user if they do not exist', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.checkScope).not.toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit a user the requester is not authorized to edit', function(done) {
            userSvc.checkScope.andReturn(false);
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this user');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.checkScope).toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit the user if the updates contain illegal fields', function(done) {
            userSvc.updateValidator.validate.andReturn(false);
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.updateValidator.validate).toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if findOne fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            userColl.findAndModify.andCallFake(function(query, sort, obj, opts, cb) {
                cb('Error!', null);
            });
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findAndModify).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('deleteUser', function() {
        var userColl;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, 'original');
                }),
                update: jasmine.createSpy('users.update').andCallFake(function(query,obj,opts,cb) {
                    cb(null, 1);
                })
            };
            req.params = { id: 'u-4567' };
            req.user = { id: 'u-1234' };
            spyOn(userSvc, 'checkScope').andReturn(true);
        });
        
        it('should fail if the user is trying to delete themselves', function(done) {
            req.params.id = 'u-1234';
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You cannot delete yourself');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully mark a user as deleted', function(done) {
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({id: 'u-4567'});
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, 'original', 'delete');
                expect(userColl.update).toHaveBeenCalled();
                expect(userColl.update.calls[0].args[0]).toEqual({id: 'u-4567'});
                var updates = userColl.update.calls[0].args[1];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.status).toBe(Status.Deleted);
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(userColl.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete a nonexistent user', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete a user the requester is not authorized to delete', function(done) {
            userSvc.checkScope.andReturn(false);
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this user');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.checkScope).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit the user if they have already been deleted', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb(null, {id: 'u-4567', status: Status.Deleted});
            });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if findOne fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb('Error!', null);
            });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            userColl.update.andCallFake(function(query, obj, ops, cb) {
                cb('Error!', null);
            });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('notifyPwdChange', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').andReturn(q('success'));
        });
        
        it('should correctly call compileAndSend', function(done) {
            userSvc.notifyPwdChange('send', 'recip').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send','recip',
                    'Your account password has been changed','pwdChange.html',{contact:'send'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.andReturn(q.reject('I GOT A PROBLEM'));
            userSvc.notifyPwdChange('send', 'recip').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).finally(done);
        });
    });
    
    describe('changePassword', function() {
        var req, userColl;
        beforeEach(function() {
            req = {
                uuid: '1234', user: { id: 'u-1' },
                body: { email: 'johnny', password: 'password', newPassword: 'crosby' }
            };
            userColl = {
                update: jasmine.createSpy('users.update').andCallFake(
                    function(query, updates, opts, cb) { cb(); })
            };
            spyOn(bcrypt, 'hash').andCallFake(function(password, salt, cb) {
                cb(null, 'fakeHash');
            });
            spyOn(bcrypt, 'genSaltSync').andReturn('sodiumChloride');
            spyOn(userSvc, 'notifyPwdChange').andReturn(q('success'));
        });

        it('fails if there is no newPassword in req.body', function(done) {
            delete req.body.newPassword;
            userSvc.changePassword(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide a new password');
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully hash and update a user\'s password', function(done) {
            userSvc.changePassword(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
                expect(userColl.update).toHaveBeenCalled();
                expect(userColl.update.calls[0].args[0]).toEqual({id: 'u-1'});
                expect(userColl.update.calls[0].args[1].$set.password).toBe('fakeHash');
                expect(userColl.update.calls[0].args[1].$set.lastUpdated instanceof Date).toBe(true);
                expect(userColl.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(bcrypt.hash.calls[0].args[0]).toBe('crosby');
                expect(bcrypt.hash.calls[0].args[1]).toBe('sodiumChloride');
                expect(userSvc.notifyPwdChange).toHaveBeenCalledWith('fakeSender', 'johnny');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should just log an error if sending a notification fails', function(done) {
            userSvc.notifyPwdChange.andReturn(q.reject('I GOT A PROBLEM'));
            userSvc.changePassword(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
                expect(userColl.update).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(userSvc.notifyPwdChange).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if hashing the password fails', function(done) {
            bcrypt.hash.andCallFake(function(password, salt, cb) { cb('I GOT A PROBLEM'); });
            userSvc.changePassword(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if the mongo update call fails', function(done) {
            userColl.update.andCallFake(function(query, updates, opts, cb) { cb('I GOT A PROBLEM'); });
            userSvc.changePassword(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(userColl.update).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('notifyEmailChange', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').andReturn(q('success'));
        });
        
        it('should correctly call compileAndSend', function(done) {
            userSvc.notifyEmailChange('send', 'recip', 'new').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send','recip',
                    'Your account email address has been changed','emailChange.html',{newEmail:'new',contact:'send'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.andReturn(q.reject('I GOT A PROBLEM'));
            userSvc.notifyEmailChange('send', 'recip', 'new').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).finally(done);
        });
    });
    
    describe('changeEmail', function() {
        var req, userColl;
        beforeEach(function() {
            req = {uuid: '1234', body: { email: 'johnny', newEmail: 'otter' }, user: { id: 'u-1' }};
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(
                    function(query, cb) { cb(); }),
                update: jasmine.createSpy('users.update').andCallFake(
                    function(query, updates, opts, cb) { cb(); })
            };
            spyOn(userSvc, 'notifyEmailChange').andReturn(q());
        });
        
        it('should fail if there is no newEmail in req.body', function(done) {
            delete req.body.newEmail;
            userSvc.changeEmail(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide a new email');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if a user with newEmail already exists', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb(null, 'A user'); });
            userSvc.changeEmail(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(409);
                expect(resp.body).toBe('A user with that email already exists');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully update a user\'s email', function(done) {
            userSvc.changeEmail(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully changed email');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({email: 'otter'});
                expect(userColl.update).toHaveBeenCalled();
                expect(userColl.update.calls[0].args[0]).toEqual({id: 'u-1'});
                expect(userColl.update.calls[0].args[1].$set.email).toBe('otter');
                expect(userColl.update.calls[0].args[1].$set.lastUpdated instanceof Date).toBe(true);
                expect(userColl.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                expect(userSvc.notifyEmailChange).toHaveBeenCalledWith('fakeSender', 'johnny', 'otter');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should just log an error if sending emails fails', function(done) {
            userSvc.notifyEmailChange.andReturn(q.reject('I GOT A PROBLEM'));
            userSvc.changeEmail(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully changed email');
                expect(userColl.update).toHaveBeenCalled();
                expect(userSvc.notifyEmailChange).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should fail if the mongo findOne call fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
            userSvc.changeEmail(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if the mongo update call fails', function(done) {
            userColl.update.andCallFake(function(query, updates, opts, cb) { cb('I GOT A PROBLEM'); });
            userSvc.changeEmail(req, userColl, 'fakeSender').then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).toHaveBeenCalled();
                done();
            });
        });
    });
});

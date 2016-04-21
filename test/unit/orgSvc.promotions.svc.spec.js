var flush = true;
describe('orgSvc-orgs (UT)', function() {
    var promModule, express, JobManager, q, mockLog, logger, CrudSvc, Model, mockDb, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        express         = require('express');
        logger          = require('../../lib/logger');
        promModule      = require('../../bin/orgSvc-promotions');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        JobManager      = require('../../lib/jobManager');
        authUtils       = require('../../lib/authUtils');
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        req = {
            uuid: '1234',
            user: { id: 'u-1', org: 'o-1' },
            requester: { id: 'u-1', permissions: {}, fieldValidation: {} }
        };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
        
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            svc = promModule.setupSvc(mockDb);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'promotions' });
            expect(svc.objName).toBe('promotions');
            expect(svc._prefix).toBe('pro');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(promModule.schemas.promotions);
        });
        
        it('should validate the data on create and edit', function() {
            expect(svc._middleware.create).toContain(promModule.validateData);
            expect(svc._middleware.edit).toContain(promModule.validateData);
        });
    });
    
    describe('promotion validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = promModule.setupSvc(mockDb);
            newObj = { type: 'signupReward' };
            origObj = {};
            requester = { fieldValidation: { referralCodes: {} } };
        });

        describe('when handling name', function() {
            it('should fail if the field is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });
            
            it('should allow the field to be set', function() {
                newObj.name = 'boris';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.name).toEqual('boris');
            });
        });
        
        describe('when handling type', function() {
            it('should fail if the field is not a string', function() {
                newObj.type = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'type must be in format: string' });
            });
            
            it('should allow the field to be set and changed', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.type).toEqual('signupReward');

                origObj.type = 'free money';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.type).toEqual('signupReward');
            });

            it('should fail if the field is not defined', function() {
                delete newObj.type;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: type' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.type;
                origObj.type = 'signupReward';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.type).toEqual('signupReward');
            });

            it('should fail if the field is not one of the acceptable values', function() {
                newObj.type = 'freeeeeeee money baby';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'type is UNACCEPTABLE! acceptable values are: [signupReward]' });
            });
        });
        
        describe('when handling data', function() {
            it('should default to an empty object', function() {
                delete newObj.data;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.data).toEqual({});
            });
            
            it('should prevent users from unsetting the field', function() {
                newObj.data = null;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.data).toEqual({});
            });
            
            it('should fail if the field is not an object', function() {
                newObj.data = 'foo';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'data must be in format: object' });
            });
        });
    });
    
    describe('validateData', function() {
        beforeEach(function() {
            req.body = { data: {} };
            req.method = 'POST';
        });

        describe('if the type is signupReward', function() {
            beforeEach(function() {
                req.body.type = 'signupReward';
                req.body.data.rewardAmount = 50;
            });
            
            it('should call next if the body is valid', function() {
                promModule.validateData(req, nextSpy, doneSpy);
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ type: 'signupReward', data: { rewardAmount: 50 } });
            });
            
            it('should call done if the rewardAmount is not defined', function() {
                delete req.body.data.rewardAmount;
                promModule.validateData(req, nextSpy, doneSpy);
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Missing required field: data.rewardAmount' });
            });
            
            it('should call done if the rewardAmount is not valid', function() {
                req.body.data.rewardAmount = -123;
                promModule.validateData(req, nextSpy, doneSpy);
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'data.rewardAmount must be greater than the min: 0' });
                
                req.body.data.rewardAmount = 'soooo many dollars';
                promModule.validateData(req, nextSpy, doneSpy);
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'data.rewardAmount must be in format: number' });
                
                expect(nextSpy).not.toHaveBeenCalled();
            });
            
            it('should be able to read the type from the origObj', function() {
                req.origObj = { type: 'signupReward', data: { rewardAmount: 2000 } };
                req.body.data.rewardAmount = -10;

                promModule.validateData(req, nextSpy, doneSpy);
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'data.rewardAmount must be greater than the min: 0' });
            });
        });
    });
    
    describe('setupEndpoints', function() {
        var app, svc, sessions, audit, jobManager, mockRouter, expressRoutes, authMidware, res;
        beforeEach(function() {
            mockRouter = {}, expressRoutes = {};
            ['get', 'post', 'put', 'delete'].forEach(function(verb) {
                expressRoutes[verb] = {};
                mockRouter[verb] = jasmine.createSpy('router.' + verb).and.callFake(function(route/*, middleware...*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes[verb][route] = (expressRoutes[verb][route] || []).concat(middleware);
                });
            });
            mockRouter.use = jasmine.createSpy('router.use()');
            spyOn(express, 'Router').and.returnValue(mockRouter);
            
            var authMidware = {
                read: 'fakeReadMidware',
                create: 'fakeCreateMidware',
                edit: 'fakeEditMidware',
                delete: 'fakeDeleteMidware'
            };
            spyOn(authUtils, 'crudMidware').and.returnValue(authMidware);

            app = { use: jasmine.createSpy('app.use()') };
            svc = {
                getObjs: jasmine.createSpy('svc.getObjs()').and.returnValue(q('yay')),
                createObj: jasmine.createSpy('svc.createObj()').and.returnValue(q('yay')),
                editObj: jasmine.createSpy('svc.editObj()').and.returnValue(q('yay')),
                deleteObj: jasmine.createSpy('svc.deleteObj()').and.returnValue(q('yay'))
            };
            sessions = 'sessionsMidware';
            audit = 'auditMidware';

            jobManager = new JobManager('fakeCache', {});
            spyOn(jobManager.setJobTimeout, 'bind').and.returnValue(jobManager.setJobTimeout);
            spyOn(jobManager, 'endJob').and.returnValue(q());

            res = { send: jasmine.createSpy('res.send()') };

            promModule.setupEndpoints(app, svc, sessions, audit, jobManager);
        });
        
        it('should create a router and attach it to the app', function() {
            expect(express.Router).toHaveBeenCalled();
            expect(mockRouter.use).toHaveBeenCalledWith(jobManager.setJobTimeout);
            expect(app.use).toHaveBeenCalledWith('/api/promotions?', mockRouter);
        });

        it('should call authUtils.crudMidware to get a set of auth middleware', function() {
            expect(authUtils.crudMidware).toHaveBeenCalledWith('promotions', { allowApps: true });
        });
        
        describe('creates a handler for GET /api/promotions/:id that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.get).toHaveBeenCalledWith('/:id', sessions, 'fakeReadMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    req.params = { id: 'pro-1' };
                    handler = expressRoutes.get['/:id'][expressRoutes.get['/:id'].length - 1];
                    svc.getObjs.and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call svc.getObjs and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'fulfilled', value: { code: 400, body: 'i got a problem with YOU' } });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(svc.getObjs).toHaveBeenCalledWith({ id: 'pro-1' }, req, false);
                    }).done(done);
                });
                
                it('should handle errors from svc.getObjs', function(done) {
                    svc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'rejected', reason: 'I GOT A PROBLEM' });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });

        describe('creates a handler for GET /api/promotions/ that', function() {
            var handler;
            beforeEach(function() {
                req.query = {};
                handler = expressRoutes.get['/'][expressRoutes.get['/'].length - 1];
                svc.getObjs.and.returnValue(q({ code: 200, body: [{ id: 'pro-1' }] }));
            });
            
            it('should call svc.getObjs and return the response', function(done) {
                q(handler(req, res, nextSpy)).finally(function() {
                    expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                        { state: 'fulfilled', value: { code: 200, body: [{ id: 'pro-1' }] } });
                    expect(res.send).not.toHaveBeenCalled();
                    expect(nextSpy).not.toHaveBeenCalled();
                    expect(svc.getObjs).toHaveBeenCalledWith({}, req, true);
                }).done(done);
            });

            it('should handle certain query params', function(done) {
                req.query = {
                    ids: 'pro-1,pro-2,pro-3',
                    name: 'Best Promotion',
                    type: 'signupReward',
                    invalid: 'hehe'
                };
                q(handler(req, res, nextSpy)).finally(function() {
                    expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                        { state: 'fulfilled', value: { code: 200, body: [{ id: 'pro-1' }] } });
                    expect(res.send).not.toHaveBeenCalled();
                    expect(nextSpy).not.toHaveBeenCalled();
                    expect(svc.getObjs).toHaveBeenCalledWith(
                        { id: ['pro-1', 'pro-2', 'pro-3'], name: 'Best Promotion', type: 'signupReward' }, req, true);
                }).done(done);
            });
            
            it('should handle invalid query param values', function(done) {
                q.all([
                    { name: { $gt: '' } },
                    { type: { $gt: '' } },
                    { ids: { $gt: '' } },
                    { ids: 'foo,,,bar' }
                ].map(function(query) {
                    var reqCopy = JSON.parse(JSON.stringify(req));
                    reqCopy.query = query;
                    return q(handler(reqCopy, res, nextSpy));
                })).then(function() {
                    expect(svc.getObjs.calls.count()).toBe(4);
                    expect(svc.getObjs).toHaveBeenCalledWith({ name: '[object Object]' }, jasmine.any(Object), true);
                    expect(svc.getObjs).toHaveBeenCalledWith({ type: '[object Object]' }, jasmine.any(Object), true);
                    expect(svc.getObjs).toHaveBeenCalledWith({ id: ['[object Object]'] }, jasmine.any(Object), true);
                    expect(svc.getObjs).toHaveBeenCalledWith({ id: ['foo', '', '', 'bar'] }, jasmine.any(Object), true);
                }).done(done);
            });
            
            it('should handle errors from svc.getObjs', function(done) {
                svc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM'));
                q(handler(req, res, nextSpy)).finally(function() {
                    expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                        { state: 'rejected', reason: 'I GOT A PROBLEM' });
                    expect(res.send).not.toHaveBeenCalled();
                    expect(nextSpy).not.toHaveBeenCalled();
                }).done(done);
            });
        });

        describe('creates a handler for POST /api/promotions/ that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.post).toHaveBeenCalledWith('/', sessions, 'fakeCreateMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/'][expressRoutes.post['/'].length - 1];
                    svc.createObj.and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call svc.getObjs and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'fulfilled', value: { code: 400, body: 'i got a problem with YOU' } });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(svc.createObj).toHaveBeenCalledWith(req);
                    }).done(done);
                });
                
                it('should handle errors from svc.getObjs', function(done) {
                    svc.createObj.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'rejected', reason: 'I GOT A PROBLEM' });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });

        describe('creates a handler for PUT /api/promotions/:id that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.put).toHaveBeenCalledWith('/:id', sessions, 'fakeEditMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.put['/:id'][expressRoutes.put['/:id'].length - 1];
                    svc.editObj.and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call svc.getObjs and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'fulfilled', value: { code: 400, body: 'i got a problem with YOU' } });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(svc.editObj).toHaveBeenCalledWith(req);
                    }).done(done);
                });
                
                it('should handle errors from svc.getObjs', function(done) {
                    svc.editObj.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'rejected', reason: 'I GOT A PROBLEM' });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });

        describe('creates a handler for DELETE /api/promotions/:id that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.delete).toHaveBeenCalledWith('/:id', sessions, 'fakeDeleteMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.delete['/:id'][expressRoutes.delete['/:id'].length - 1];
                    svc.deleteObj.and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call svc.getObjs and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'fulfilled', value: { code: 400, body: 'i got a problem with YOU' } });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(svc.deleteObj).toHaveBeenCalledWith(req);
                    }).done(done);
                });
                
                it('should handle errors from svc.getObjs', function(done) {
                    svc.deleteObj.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'rejected', reason: 'I GOT A PROBLEM' });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
});
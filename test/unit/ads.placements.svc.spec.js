var flush = true;
describe('ads-placements (UT)', function() {
    var mockLog, CrudSvc, QueryCache, Model, Status, logger, q, placeModule, historian, mongoUtils,
        fs, util, mockDb, nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        fs              = require('fs-extra');
        util            = require('util');
        logger          = require('../../lib/logger');
        placeModule     = require('../../bin/ads-placements');
        CrudSvc         = require('../../lib/crudSvc');
        historian       = require('../../lib/historian');
        mongoUtils      = require('../../lib/mongoUtils');
        QueryCache      = require('../../lib/queryCache');
        Model           = require('../../lib/model');
        Status          = require('../../lib/enums').Status;

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

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        placeModule.config.cacheTTLs = {
            placements: {
                freshTTL: 1,
                maxTTL: 4
            },
            cloudFront: 5
        };
        
        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });

    describe('setupSvc', function() {
        var svc, config, costHistMidware;
        beforeEach(function() {
            config = {
                cacheTTLs: {
                    placements: { freshTTL: 10, maxTTL: 40 },
                    cloudFront: 50
                }
            };
            spyOn(placeModule.validateExtRefs, 'bind').and.returnValue(placeModule.validateExtRefs);
            spyOn(placeModule.getPublicPlacement, 'bind').and.returnValue(placeModule.getPublicPlacement);
            
            costHistMidware = jasmine.createSpy('handleCostHist');
            spyOn(historian, 'middlewarify').and.returnValue(costHistMidware);
            
            svc = placeModule.setupSvc(mockDb, config );
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'placements' });
            expect(svc.objName).toBe('placements');
            expect(svc._prefix).toBe('pl');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(placeModule.placeSchema);
        });

        it('should save some config variables locally', function() {
            expect(placeModule.config.cacheTTLs).toEqual({ placements: { freshTTL: 10, maxTTL: 40 }, cloudFront: 50 });
        });

        it('should save some bound methods on the service', function() {
            expect(svc.getPublicPlacement).toEqual(placeModule.getPublicPlacement);
            expect(placeModule.getPublicPlacement.bind).toHaveBeenCalledWith(placeModule, svc, jasmine.any(QueryCache));

            var cache = placeModule.getPublicPlacement.bind.calls.argsFor(0)[2];
            expect(cache.freshTTL).toBe(10*60*1000);
            expect(cache.maxTTL).toBe(40*60*1000);
            expect(cache._coll).toEqual({ collectionName: 'placements' });
        });
        
        it('should validate references to other objects on create and edit', function() {
            expect(placeModule.validateExtRefs.bind).toHaveBeenCalledWith(placeModule, svc);
            expect(svc._middleware.create).toContain(placeModule.validateExtRefs);
            expect(svc._middleware.edit).toContain(placeModule.validateExtRefs);
        });
        
        it('should manage the costHistory on create and edit', function() {
            expect(historian.middlewarify).toHaveBeenCalledWith('externalCost', 'costHistory');
            expect(svc._middleware.create).toContain(costHistMidware);
            expect(svc._middleware.edit).toContain(costHistMidware);
        });
    });
    
    describe('placement validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = placeModule.setupSvc(mockDb, placeModule.config );
            newObj = { tagParams: { type: 'full', container: 'box', campaign: 'cam-1' } };
            origObj = {};
            requester = { fieldValidation: { placements: {} } };
        });
        
        ['label', 'tagType'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not a string', function() {
                    newObj[field] = 1234;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
                
                it('should allow the field to be set', function() {
                    newObj[field] = 'foo';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('foo');
                });
            });
        });

        ['startDate', 'endDate'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should allow the field to be set as a Date object', function() {
                    var now = new Date();
                    newObj[field] = now;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toBe(now);
                });
                
                it('should allow the field to be set as a stringified Date', function() {
                    newObj[field] = 'Tue Jan 12 2016 17:40:11 GMT-0500 (EST)';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(new Date('Tue Jan 12 2016 17:40:11 GMT-0500 (EST)'));
                });
                
                it('should fail if the field is not a valid Date', function() {
                    newObj[field] = 'Tue Jaaaaaaaan 12 2016 17:40:11 GMT-0500 (EST)';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: Date' });
                });
            });
        });
        
        describe('when handling budget', function() {
            beforeEach(function() {
                newObj.budget = {};
                requester.fieldValidation.placements.budget = {};
            });

            ['daily', 'total'].forEach(function(field) {
                describe('subfield ' + field, function() {
                    it('should fail if the field is not a number', function() {
                        newObj.budget[field] = 'many dollars';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: 'budget.' + field + ' must be in format: number' });
                    });
                    
                    it('should allow the field to be set', function() {
                        newObj.budget[field] = 1234;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.budget[field]).toEqual(1234);
                    });
                });
            });
        });
        
        describe('externalCost', function() {
            beforeEach(function() {
                newObj.externalCost = {};
                requester.fieldValidation.placements.externalCost = {};
            });

            describe('subfield event', function() {
                it('should fail if the field is not a string', function() {
                    newObj.externalCost.event = 1234;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'externalCost.event must be in format: string' });
                });
                
                it('should allow the field to be set', function() {
                    newObj.externalCost.event = 'birthday';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.externalCost.event).toEqual('birthday');
                });
            });

            describe('subfield cost', function() {
                it('should fail if the field is not a number', function() {
                    newObj.externalCost.cost = 'many dollars';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'externalCost.cost must be in format: number' });
                });
                
                it('should allow the field to be set', function() {
                    newObj.externalCost.cost = 1234;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.externalCost.cost).toEqual(1234);
                });
            });
        });

        describe('when handling costHistory', function() {
            it('should not allow anyone to set the field', function() {
                requester.fieldValidation.placements.costHistory = { __allowed: true };
                newObj.costHistory = 'yesterday it cost a lot';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.costHistory).not.toBeDefined();
            });
        });

        describe('when handling tagParams', function() {
            beforeEach(function() {
                requester.fieldValidation.placements.tagParams = {};
            });
        
            it('should fail if not an object', function() {
                newObj.tagParams = 'big tagParams big problems';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'tagParams must be in format: object' });
            });
            
            it('should fail if the field is not set on create', function() {
                delete newObj.tagParams;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: tagParams' });
                expect(newObj.tagParams).toEqual();
            });
            
            it('should not allow the field to be unset', function() {
                origObj.tagParams = { container: 'box', campaign: 'cam-1' };
                newObj.tagParams = null;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.tagParams).toEqual({ container: 'box', campaign: 'cam-1' });
                
                newObj.tagParams = undefined;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.tagParams).toEqual({ container: 'box', campaign: 'cam-1' });
            });
            
            ['container', 'campaign', 'type'].forEach(function(field) {
                describe('subfield ' + field, function() {
                    it('should fail if the field is not a string', function() {
                        newObj.tagParams[field] = 1234;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: 'tagParams.' + field + ' must be in format: string' });
                    });
                    
                    it('should fail if the field is not set', function() {
                        delete newObj.tagParams[field];
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: 'Missing required field: tagParams.' + field });
                    });

                    it('should pass if the field was set on the origObj', function() {
                        origObj.tagParams = { type: 'oldType', container: 'old container', campaign: 'cam-old' };
                        delete newObj.tagParams[field];
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.tagParams[field]).toEqual(origObj.tagParams[field]);
                    });
                    
                    it('should allow the field to be set', function() {
                        newObj.tagParams[field] = 'foo';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.tagParams[field]).toEqual('foo');
                    });
                });
            });
            
            ['card', 'experience'].forEach(function(field) {
                describe('subfield ' + field, function() {
                    it('should fail if the field is not a string', function() {
                        newObj.tagParams[field] = 1234;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: 'tagParams.' + field + ' must be in format: string' });
                    });
                    
                    it('should allow the field to be set', function() {
                        newObj.tagParams[field] = 'foo';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.tagParams[field]).toEqual('foo');
                    });
                });
            });
        });
        
        describe('when handling showInTag', function() {
            it('should allow the field to be set', function() {
                newObj.showInTag = { foo: true };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.showInTag).toEqual({ foo: true });
            });
            
            it('should fail if the field is not an object', function() {
                newObj.showInTag = 'asdf';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'showInTag must be in format: object' });
            });
            
            it('should default the field to an empty object', function() {
                delete newObj.showInTag;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.showInTag).toEqual({});
            });
            
            it('should not allow the field to be unset', function() {
                origObj.showInTag = { foo: true };
                newObj.showInTag = null;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.showInTag).toEqual({ foo: true });
            });
        });
    });
    
    describe('validateExtRefs', function() {
        var svc, resps;
        beforeEach(function() {
            req.body = {
                tagParams: {
                    container: 'box',
                    campaign: 'cam-1',
                    card: 'rc-1',
                    experience: 'e-1'
                }
            };
            resps = {
                campaigns: { id: 'cam-1', advertiserId: 'a-1', name: 'camp1' },
                containers: { id: 'con-1', name: 'container1' },
                cards: { id: 'rc-1', name: 'card1' },
                experiences: { id: 'e-1', name: 'exp1' },
                advertisers: { id: 'a-1', name: 'advertiser1' },
            };
            spyOn(mongoUtils, 'findObject').and.callFake(function(coll, query) {
                return q(resps[coll.collectionName]);
            });
            svc = { _db: mockDb };
        });
        
        it('should check that all linked entities in req.body.tagParams exist and call next', function(done) {
            placeModule.validateExtRefs(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toEqual({ id: 'cam-1', advertiserId: 'a-1', name: 'camp1' });
                expect(req.container).toEqual({ id: 'con-1', name: 'container1' });
                expect(req.card).toEqual({ id: 'rc-1', name: 'card1' });
                expect(req.experience).toEqual({ id: 'e-1', name: 'exp1' });
                expect(req.advertiser).toEqual({ id: 'a-1', name: 'advertiser1' });

                expect(mongoUtils.findObject.calls.count()).toBe(5);
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'containers' },
                    { name: 'box', status: { $ne: Status.Deleted } });
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'campaigns' }, {
                    id: 'cam-1',
                    status: { $nin: [Status.Deleted, Status.Canceled, Status.Expired, Status.OutOfBudget] }
                });
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'experiences' }, { id: 'e-1', 'status.0.status': { $ne: Status.Deleted } });
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'cards' }, { id: 'rc-1', campaignId: 'cam-1', status: { $ne: Status.Deleted } });
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'advertisers' }, { id: 'a-1',status: { $ne: Status.Deleted } });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should skip entities that are not defined in req.body.tagParams', function(done) {
            delete req.body.tagParams.card;
            delete req.body.tagParams.experience;
            placeModule.validateExtRefs(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toBeDefined();
                expect(req.container).toBeDefined();
                expect(req.card).not.toBeDefined();
                expect(req.experience).not.toBeDefined();
                expect(req.advertiser).toBeDefined();
                expect(mongoUtils.findObject.calls.count()).toBe(3);
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'containers' }, jasmine.any(Object));
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'campaigns' }, jasmine.any(Object));
                expect(mongoUtils.findObject).toHaveBeenCalledWith({ collectionName: 'advertisers' }, jasmine.any(Object));
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should call done if an entity cannot be found', function(done) {
            delete resps.cards;
            placeModule.validateExtRefs(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'card rc-1 not found' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should only call done once', function(done) {
            delete resps.cards;
            delete resps.containers;
            placeModule.validateExtRefs(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'container box not found' });
                expect(doneSpy.calls.count()).toBe(1);
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if one or more queries fail', function(done) {
            resps.experiences = q.reject('Experiences got a problem');
            resps.campaigns = q.reject('Campaigns got a problem');
            placeModule.validateExtRefs(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error.calls.count()).toBe(2);
            }).done(done);
        });
    });
    
    describe('getPublicPlacement', function() {
        var svc, cache, mockPlacement;
        beforeEach(function() {
            mockPlacement = {
                _id             : 'mongo123',
                id              : 'pl-1',
                status          : Status.Active,
                user            : 'u-1',
                org             : 'o-1',
                externalCost    : { event: 'click', cost: 1.0 },
                costHistory     : [{ yesterday: 'expensive' }],
                budget          : { daily: 100, total: 1000 },
                tagParams            : { foo: 'bar' }
            };
            cache = {
                getPromise: jasmine.createSpy('cache.getPromise').and.callFake(function() { return q([mockPlacement]); })
            };
            svc = {
                formatOutput: spyOn(CrudSvc.prototype, 'formatOutput').and.callThrough()
            };
        });
        
        it('should retrieve and format a placement from the cache', function(done) {
            placeModule.getPublicPlacement(svc, cache, 'pl-1', req).then(function(resp) {
                expect(resp).toEqual({
                    id: 'pl-1',
                    status: Status.Active,
                    tagParams: { foo: 'bar' }
                });
                expect(cache.getPromise).toHaveBeenCalledWith({ id: 'pl-1' });
                expect(svc.formatOutput).toHaveBeenCalledWith(mockPlacement);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the placement is not found', function(done) {
            mockPlacement = undefined;
            placeModule.getPublicPlacement(svc, cache, 'pl-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(cache.getPromise).toHaveBeenCalledWith({ id: 'pl-1' });
                expect(svc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the found placement is not active', function(done) {
            mockPlacement.status = Status.Inactive;
            placeModule.getPublicPlacement(svc, cache, 'pl-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(cache.getPromise).toHaveBeenCalledWith({ id: 'pl-1' });
                expect(svc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the cache returns an error', function(done) {
            cache.getPromise.and.returnValue(q.reject('I GOT A PROBLEM'));
            placeModule.getPublicPlacement(svc, cache, 'pl-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(cache.getPromise).toHaveBeenCalledWith({ id: 'pl-1' });
                expect(svc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('handlePublicGet', function() {
        var svc, res;
        beforeEach(function() {
            svc = {
                getPublicPlacement: jasmine.createSpy('svc.getPublicPlacement()').and.returnValue(q({ id: 'pl-1', tagParams: { foo: 'bar' } }))
            };
            res = {
                header: jasmine.createSpy('res.header()')
            };
            req.params = {
                id: 'pl-1'
            };
            req.query = {};
        });
        
        it('should set the cache-control and return a 200 if the placement is found', function(done) {
            placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { id: 'pl-1', tagParams: { foo: 'bar' } } });
                expect(svc.getPublicPlacement).toHaveBeenCalledWith('pl-1', req);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should set the cache-control and return a 404 if the placement is not found', function(done) {
            svc.getPublicPlacement.and.returnValue(q());
            placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Placement not found' });
                expect(svc.getPublicPlacement).toHaveBeenCalledWith('pl-1', req);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        describe('if the request extension is js', function() {
            beforeEach(function() {
                req.params.ext = 'js';
            });

            it('should return the placement as a CommonJS module', function(done) {
                placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: 'module.exports = {"id":"pl-1","tagParams":{"foo":"bar"}};' });
                    expect(svc.getPublicPlacement).toHaveBeenCalledWith('pl-1', req);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not alter non-200 responses', function(done) {
                svc.getPublicPlacement.and.returnValue(q());
                placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                    expect(resp).toEqual({ code: 404, body: 'Placement not found' });
                    expect(svc.getPublicPlacement).toHaveBeenCalledWith('pl-1', req);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if the request is in preview mode', function() {
            beforeEach(function() {
                req.query.preview = true;
            });

            it('should not set the cache-control header', function(done) {
                placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: { id: 'pl-1', tagParams: { foo: 'bar' } } });
                    expect(svc.getPublicPlacement).toHaveBeenCalledWith('pl-1', req);
                    expect(res.header).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should set the cache-control and return a 500 if an error is returned', function(done) {
            svc.getPublicPlacement.and.returnValue(q.reject('I GOT A PROBLEM'));
            placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                expect(resp).toEqual({ code: 500, body: { error: 'Error retrieving placement', detail: 'I GOT A PROBLEM' } });
                expect(svc.getPublicPlacement).toHaveBeenCalledWith('pl-1', req);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=60');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
});

var flush = true;
var objUtils = require('../../lib/objUtils');

describe('orgSvc-orgs (UT)', function() {
    var orgModule, q, mockLog, mockLogger, logger, CrudSvc, Model, enums, Status, Scope,
        mockDb, mockGateway, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        orgModule       = require('../../bin/orgSvc-orgs');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
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
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' }, requester: { id: 'u-1', permissions: {} } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        mockGateway = {
            customer: {
                delete: jasmine.createSpy('gateway.customer.delete()')
            }
        };
    });

    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            [CrudSvc.prototype.validateUniqueProp, orgModule.activeUserCheck].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });

            svc = orgModule.setupSvc(mockDb, mockGateway);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'orgs' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('orgs');
            expect(svc._prefix).toBe('o');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._ownedByUser).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(orgModule.orgSchema);
        });

        it('should check special permissions on create', function() {
            expect(svc._middleware.create).toContain(orgModule.createPermCheck);
        });

        it('should setup the org\'s config on create', function() {
            expect(svc._middleware.create).toContain(orgModule.setupConfig);
        });

        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);
        });

        it('should check special permissions on delete', function() {
            expect(svc._middleware.delete).toContain(orgModule.deletePermCheck);
        });

        it('should prevent deleting active orgs with active users', function() {
            expect(svc._middleware.delete).toContain(orgModule.activeUserCheck);
            expect(orgModule.activeUserCheck.bind).toHaveBeenCalledWith(orgModule, svc);
        });
    });

    describe('org validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = orgModule.setupSvc(mockDb, mockGateway);
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { orgs: {} } };
        });

        describe('when handling name', function() {
            it('should fail if the field is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });

            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.name;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: name' });
            });

            it('should pass if the field was defined on the original object', function() {
                delete newObj.name;
                origObj.name = 'old org name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old org name' });
            });

            it('should allow the field to be changed', function() {
                origObj.name = 'old pol name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });
        });

        describe('when handling adConfig', function() {
            it('should trim the field if set', function() {
                newObj.adConfig = { ads: 'yes' };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });

            it('should be able to allow some requesters to set the field', function() {
                newObj.adConfig = { ads: 'yes' };
                requester.fieldValidation.orgs.adConfig = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', adConfig: { ads: 'yes' } });
            });

            it('should fail if the field is not an object', function() {
                newObj.adConfig = [{ ads: 'yes' }, { moreAds: 'no' }];
                requester.fieldValidation.orgs.adConfig = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'adConfig must be in format: object' });
            });
        });

        // config objects
        ['config', 'waterfalls'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not an object', function() {
                    newObj[field] = 123;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: object' });
                });

                it('should allow the field to be set', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual({ foo: 'bar' });
                });
            });
        });

        ['braintreeCustomer', 'referralCode', 'paymentPlanId'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = '123456';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ name: 'test' });
                });

                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = '123456';
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('123456');
                });

                it('should fail if the field is not a string', function() {
                    newObj[field] = 123456;
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
            });
        });

        ['paymentPlanStart'].forEach(function(field) {
            describe('when handling ' + field, function() {
                beforeEach(function() {
                    jasmine.clock().install();
                    jasmine.clock().mockDate();
                });

                afterEach(function() {
                    jasmine.clock().uninstall();
                });

                it('should trim the field if set', function() {
                    newObj[field] = new Date().toISOString();
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ name: 'test' });
                });

                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = new Date().toISOString();
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(new Date());
                });

                it('should fail if the field is not a Date', function() {
                    newObj[field] = 'whaddup homes';
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: Date' });
                });
            });
        });

        describe('when handling promotions', function() {
            beforeEach(function() {
                requester.fieldValidation.orgs.promotions = {};
            });

            it('should trim the field if set', function() {
                newObj.promotions = [{ id: 'pro-1', date: new Date() }];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.promotions).not.toBeDefined();
            });

            describe('if the requester can set the field', function() {
                beforeEach(function() {
                    requester.fieldValidation.orgs.promotions.__allowed = true;
                });

                it('should succeed', function() {
                    newObj.promotions = [{
                        id: 'pro-1',
                        created: new Date('2016-02-20T00:25:32.645Z'),
                        lastUpdated: new Date('2016-04-10T00:25:32.645Z'),
                        status: Status.Active
                    }];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.promotions).toEqual([{
                        id: 'pro-1',
                        created: new Date('2016-02-20T00:25:32.645Z'),
                        lastUpdated: new Date('2016-04-10T00:25:32.645Z'),
                        status: Status.Active
                    }]);
                });

                it('should cast string dates into Date objects', function() {
                    newObj.promotions = [{
                        id: 'pro-1',
                        created: '2016-02-20T00:25:32.645Z',
                        lastUpdated: '2016-04-10T00:25:32.645Z',
                        status: Status.Canceled
                    }];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.promotions).toEqual([{
                        id: 'pro-1',
                        created: new Date('2016-02-20T00:25:32.645Z'),
                        lastUpdated: new Date('2016-04-10T00:25:32.645Z'),
                        status: Status.Canceled
                    }]);
                });

                it('should fail if the field is not an object array', function() {
                    newObj.promotions = ['foo', 'bar'];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'promotions must be in format: objectArray' });
                });

                it('should fail if any entry subfields are in the wrong format', function() {
                    var base = {
                        id: 'pro-1',
                        created: '2016-02-20T00:25:32.645Z',
                        lastUpdated: '2016-04-10T00:25:32.645Z',
                        status: Status.Canceled
                    };

                    var resps = [{ id: 123 }, { created: 'today' }, { lastUpdated: 432 }, { status: 4331 }].map(function(obj) {
                        newObj.promotions = [obj];
                        objUtils.extend(newObj.promotions[0], base);
                        return svc.model.validate('create', newObj, origObj, requester);
                    });
                    expect(resps[0]).toEqual({ isValid: false, reason: 'promotions[0].id must be in format: string' });
                    expect(resps[1]).toEqual({ isValid: false, reason: 'promotions[0].created must be in format: Date' });
                    expect(resps[2]).toEqual({ isValid: false, reason: 'promotions[0].lastUpdated must be in format: Date' });
                    expect(resps[3]).toEqual({ isValid: false, reason: 'promotions[0].status must be in format: string' });
                });
            });
        });
    });

    describe('createPermCheck', function() {
        beforeEach(function() {
            req.requester.permissions = { orgs: { create: Scope.All } };
        });

        it('should call next if the requester has admin-level create priviledges', function(done) {
            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if the requester does not have admin-level create priviledges', function(done) {
            req.requester.permissions.orgs.create = Scope.Own;

            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to create orgs' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });

    describe('setupConfig', function() {
        beforeEach(function() {
            req.body = { id: 'o-1', name: 'new org' };
        });

        it('should initialize some props on the new org and call next', function(done) {
            orgModule.setupConfig(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();

                expect(req.body.config).toEqual({});
                expect(req.body.waterfalls).toEqual({ video: ['cinema6'], display: ['cinema6'] });
                done();
            });
        });

        it('should respect user-defined values', function(done) {
            req.body.config = { foo: 'bar' };
            req.body.waterfalls = { video: ['mine'] };

            orgModule.setupConfig(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();

                expect(req.body.config).toEqual({ foo: 'bar' });
                expect(req.body.waterfalls).toEqual({ video: ['mine'], display: ['cinema6'] });
                done();
            });
        });
    });

    describe('deletePermCheck', function() {
        beforeEach(function() {
            req.requester.permissions = { orgs: { delete: Scope.All } };
            req.params = { id: 'o-2' };
        });

        it('should call done if a user tries deleting their own org', function(done) {
            req.params.id = req.user.org;
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'You cannot delete your own org' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if a user does not have admin delete priviledges', function(done) {
            req.requester.permissions.orgs.delete = Scope.Own;
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to delete orgs' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if everything checks out', function(done) {
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });

    describe('activeUserCheck', function() {
        var orgSvc, mockColl;
        beforeEach(function() {
            req.params = { id: 'o-2' };

            mockColl = {
                count: jasmine.createSpy('cursor.count').and.returnValue(q(3))
            };
            mockDb.collection.and.returnValue(mockColl);

            orgSvc = orgModule.setupSvc(mockDb, mockGateway);
        });

        it('should call done if the org still has active users', function(done) {
            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Org still has active users' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.count).toHaveBeenCalledWith({ org: 'o-2', status: { $ne: Status.Deleted } });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if the org has no active users', function(done) {
            mockColl.count.and.returnValue(q(0));

            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockColl.count.and.returnValue(q.reject('I GOT A PROBLEM'));

            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('runningCampaignCheck', function() {
        var orgSvc, mockColl;
        beforeEach(function() {
            req.params = { id: 'o-2' };

            mockColl = {
                count: jasmine.createSpy('cursor.count').and.returnValue(q(3))
            };
            mockDb.collection.and.returnValue(mockColl);

            orgSvc = orgModule.setupSvc(mockDb, mockGateway);
        });

        it('should call done if the org still has unfinished campaigns', function(done) {
            orgModule.runningCampaignCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Org still has unfinished campaigns' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.count).toHaveBeenCalledWith({
                    org: 'o-2',
                    status: { $in: [Status.Active, Status.Paused] }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if the org has no unfinished campaigns', function(done) {
            mockColl.count.and.returnValue(q(0));

            orgModule.runningCampaignCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockColl.count.and.returnValue(q.reject('I GOT A PROBLEM'));

            orgModule.runningCampaignCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('deleteBraintreeCustomer', function() {
        beforeEach(function() {
            mockGateway.customer.delete.and.callFake(function(id, cb) {
                cb();
            });

            req.origObj = { id: 'o-1', braintreeCustomer: '123456' };
        });

        it('should successfully delete a braintree customer', function(done) {
            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockGateway.customer.delete).toHaveBeenCalledWith('123456', jasmine.any(Function));
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should skip if no braintreeCustomer is on the org', function(done) {
            delete req.origObj.braintreeCustomer;
            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockGateway.customer.delete).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should just log a warning if the customer does not exist', function(done) {
            mockGateway.customer.delete.and.callFake(function(id, cb) {
                var error = new Error('Customer not found');
                error.name = 'notFoundError';
                cb(error);
            });

            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockGateway.customer.delete).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if braintree returns a different error', function(done) {
            mockGateway.customer.delete.and.callFake(function(id, cb) {
                var error = new Error('I GOT A PROBLEM');
                error.name = 'badError';
                cb(error);
            });

            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Braintree error');
                expect(mockGateway.customer.delete).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('getPaymentPlan', function() {
        beforeEach(function() {
            this.req = {
                params: {
                    id: 'o-123'
                },
                query: { }
            };
            this.mockOrg = {
                id: 'o-123',
                paymentPlanId: 'pp-123',
                nextPaymentPlanId: 'pp-456'
            };
            this.svc = orgModule.setupSvc(mockDb, mockGateway);
            spyOn(this.svc, 'getObjs').and.returnValue(q.resolve({
                code: 200,
                body: [this.mockOrg]
            }));
        });

        it('should get the requested org\'s payment plan from mongo', function(done) {
            var self = this;
            orgModule.getPaymentPlan(self.svc, this.req).then(function() {
                expect(self.svc.getObjs).toHaveBeenCalledWith({ id: 'o-123' }, {
                    params: {
                        id: 'o-123'
                    },
                    query: {
                        fields: 'paymentPlanId,nextPaymentPlanId'
                    }
                }, false);
            }).then(done, done.fail);
        });

        it('should be able to resolve with a 200 and any current and pending payment plan', function(done) {
            var self = this;
            orgModule.getPaymentPlan(self.svc, self.req).then(function(result) {
                expect(result).toEqual({
                    code: 200,
                    body: self.mockOrg
                });
            }).then(done, done.fail);
        });

        it('should be able to resolve with a 404 if there is no such org', function(done) {
            this.svc.getObjs.and.returnValue(q.resolve({
                code: 404,
                body: 'Object not found'
            }));
            orgModule.getPaymentPlan(this.svc, this.req).then(function(result) {
                expect(result).toEqual({
                    code: 404,
                    body: 'Object not found'
                });
            }).then(done, done.fail);
        });

        it('should reject if an error occurs querying from mongo', function(done) {
            this.svc.getObjs.and.returnValue(q.reject(new Error('epic fail')));
            orgModule.getPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                expect(error.message).toBe('epic fail');
            }).then(done, done.fail);
        });
    });
});

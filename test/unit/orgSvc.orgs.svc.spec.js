var flush = true;
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
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

        req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
        
        mockDb = {
            collection: jasmine.createSpy('db.collection()').andCallFake(function(objName) {
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
            [CrudSvc.prototype.preventGetAll, CrudSvc.prototype.validateUniqueProp,
             orgModule.activeUserCheck].forEach(function(fn) {
                spyOn(fn, 'bind').andReturn(fn);
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
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(orgModule.orgSchema);
        });
        
        it('should override some internal CrudSvc functions', function() {
            expect(svc.userPermQuery).toBe(orgModule.userPermQuery);
            expect(svc.checkScope).toBe(orgModule.checkScope);
        });
        
        it('should prevent getting all orgs', function() {
            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(CrudSvc.prototype.preventGetAll.bind).toHaveBeenCalledWith(svc);
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
                    .toEqual({ isValid: true });
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
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'old org name' });
            });

            it('should allow the field to be changed', function() {
                origObj.name = 'old pol name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'test' });
            });
        });
        
        describe('when handling adConfig', function() {
            it('should trim the field if set', function() {
                newObj.adConfig = { ads: 'yes' };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'test' });
            });
            
            it('should be able to allow some requesters to set the field', function() {
                newObj.adConfig = { ads: 'yes' };
                requester.fieldValidation.orgs.adConfig = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true });
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
                        .toEqual({ isValid: true });
                    expect(newObj[field]).toEqual({ foo: 'bar' });
                });
            });
        });
        
        describe('when handling braintreeCustomer', function() {
            it('should trim the field if set', function() {
                newObj.braintreeCustomer = '123456';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'test' });
            });
            
            it('should be able to allow some requesters to set the field', function() {
                newObj.braintreeCustomer = '123456';
                requester.fieldValidation.orgs.braintreeCustomer = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ name: 'test', braintreeCustomer: '123456' });
            });
            
            it('should fail if the field is not a string', function() {
                newObj.braintreeCustomer = 123456;
                requester.fieldValidation.orgs.braintreeCustomer = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'braintreeCustomer must be in format: string' });
            });
        });
    });
    
    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    orgs: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var orgs = [{ name: 'org-1', id: 'o-1234'},
                        { name: 'org-2', id: 'o-1234'},
                        { name: 'org-1', id: 'o-4567'},
                        { name: 'org-2', id: 'o-4567'}];
            
            expect(orgs.filter(function(target) {
                return orgModule.checkScope(requester, target, 'read');
            })).toEqual(orgs);
            expect(orgs.filter(function(target) {
                return orgModule.checkScope(requester, target, 'edit');
            })).toEqual([orgs[0], orgs[1]]);
            expect(orgs.filter(function(target) {
                return orgModule.checkScope(requester, target, 'delete');
            })).toEqual([orgs[0], orgs[1]]);
        });

        it('should sanity-check the user permissions object', function() {
            var target = { id: 'o-1' };
            expect(orgModule.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs = {};
            requester.permissions.users = { read: Scope.All };
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs.read = '';
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs.read = Scope.All;
            expect(orgModule.checkScope(requester, target, 'read')).toBe(true);
        });

    });
    
    describe('userPermQuery', function() {
        var query, requester;
        beforeEach(function() {
            query = {};
            requester = { id: 'u-1', org: 'o-1', permissions: { orgs: { read: Scope.Own } } };
        });
        
        it('should just check that the orgs are not deleted if the requester is an admin', function() {
            requester.permissions.orgs.read = Scope.All;
            expect(orgModule.userPermQuery(query, requester))
                .toEqual({ status: { $ne: Status.Deleted } });
            expect(query).toEqual({});
        });
        
        it('should only let the requester fetch their own org if they have Scope.Own', function() {
            var statusQry = { $ne: Status.Deleted };
            
            expect(orgModule.userPermQuery({}, requester)).toEqual({ id: 'o-1', status: statusQry });
            expect(orgModule.userPermQuery({ id: 'o-1' }, requester)).toEqual({ id: 'o-1', status: statusQry });
            expect(orgModule.userPermQuery({ id: 'o-2' }, requester)).toEqual({ id: { $in: [] }, status: statusQry });
            expect(orgModule.userPermQuery({ id: { $in: ['o-1', 'o-2', 'o-3'] } }, requester))
                .toEqual({ id: { $in: ['o-1'] }, status: statusQry });
            expect(orgModule.userPermQuery({ id: { $in: ['o-2', 'o-3'] } }, requester))
                .toEqual({ id: { $in: [] }, status: statusQry });
        });
                
        it('should log a warning if the requester has an invalid scope', function() {
            requester.permissions.orgs.read = 'alfkjdf';
            expect(orgModule.userPermQuery(query, requester))
                .toEqual({ id: 'o-1', status: { $ne: Status.Deleted } });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('createPermCheck', function() {
        beforeEach(function() {
            req.user.permissions = { orgs: { create: Scope.All } };
        });
        
        it('should call next if the user has admin-level create priviledges', function(done) {
            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if the user does not have admin-level create priviledges', function(done) {
            req.user.permissions.orgs.create = Scope.Own;

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
            req.user.permissions = { orgs: { delete: Scope.All } };
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
            req.user.permissions.orgs.delete = Scope.Own;
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
                count: jasmine.createSpy('cursor.count').andCallFake(function(query, cb) { cb(null, 3); })
            };
            mockDb.collection.andReturn(mockColl);

            orgSvc = orgModule.setupSvc(mockDb, mockGateway);
        });
        
        it('should call done if the org still has active users', function(done) {
            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Org still has active users' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.count).toHaveBeenCalledWith({ org: 'o-2', status: { $ne: Status.Deleted } }, jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call next if the org has no active users', function(done) {
            mockColl.count.andCallFake(function(query, cb) { cb(null, 0); });
        
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
            mockColl.count.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
        
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
                count: jasmine.createSpy('cursor.count').andCallFake(function(query, cb) { cb(null, 3); })
            };
            mockDb.collection.andReturn(mockColl);

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
                    status: { $nin: [Status.Deleted, Status.Expired, Status.Canceled] }
                }, jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call next if the org has no unfinished campaigns', function(done) {
            mockColl.count.andCallFake(function(query, cb) { cb(null, 0); });
        
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
            mockColl.count.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
        
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
            mockGateway.customer.delete.andCallFake(function(id, cb) {
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
            mockGateway.customer.delete.andCallFake(function(id, cb) {
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
            mockGateway.customer.delete.andCallFake(function(id, cb) {
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
});
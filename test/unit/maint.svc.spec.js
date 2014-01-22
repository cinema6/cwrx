var path        = require('path'),
    fs          = require('fs-extra'),
    q           = require('q'),
    cwrxConfig  = require('../../lib/config'),
    sanitize    = require('../sanitize');

describe('maint (UT)', function() {
    var maint, mockLog, mockLogger, mockAws;
    
    beforeEach(function() {
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        mockLogger = {
            createLog: jasmine.createSpy('create_log').andReturn(mockLog),
            getLog : jasmine.createSpy('get_log').andReturn(mockLog)
        };
        mockAws = {
            config: {
                loadFromPath: jasmine.createSpy('aws_config_loadFromPath')
            }
        };
    
        maint = sanitize(['../bin/maint'])
                .andConfigure([['../lib/logger', mockLogger], ['aws-sdk', mockAws]])
                .andRequire();
    });

    describe('getVersion', function() {
        var existsSpy, readFileSpy;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            readFileSpy = spyOn(fs, 'readFileSync');
        });
        
        it('should exist', function() {
            expect(maint.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            existsSpy.andReturn(true);
            readFileSpy.andReturn('ut123');
            
            expect(maint.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
        });
    });

    describe('createConfiguration', function() {
        var existsSpy, mkdirSpy, createConfig, mockConfig;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            mkdirSpy = spyOn(fs, 'mkdirsSync');
            mockConfig = {
                caches: {
                    line: 'ut/line/',
                    script: 'ut/script/',
                },
                log: {
                    logLevel: 'trace'
                },
                s3: {
                    auth: 'fakeAuth.json'
                }
            },
            createConfig = spyOn(cwrxConfig, 'createConfigObject').andReturn(mockConfig);
        });
    
        it('should exist', function() {
            expect(maint.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = maint.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', maint.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(mockAws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
            
            expect(cfgObject.caches.line).toBe('ut/line/');
            expect(cfgObject.caches.script).toBe('ut/script/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should throw an error if it can\'t load the s3 config', function() {
            mockAws.config.loadFromPath.andThrow('Exception!');
            expect(function() {maint.createConfiguration({config: 'utConfig'})}).toThrow();

            mockAws.config.loadFromPath.andReturn();
            delete mockConfig.s3;
            expect(function() {maint.createConfiguration({config: 'utConfig'})}).toThrow();
        });

        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = maint.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(false);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.length).toBe(2);
                expect(mkdirSpy.calls.length).toBe(2);
                expect(existsSpy).toHaveBeenCalledWith('ut/line/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/line/');
                expect(existsSpy).toHaveBeenCalledWith('ut/script/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/script/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = maint.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(true);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.length).toBe(2);
                expect(mkdirSpy).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = maint.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.mp3', 'line')).toBe('ut/line/test.mp3');
        });
    });

    describe('removeFiles', function() {
        var removeSpy, existsSpy,
            doneFlag = false,
            files = ['abc.mp3', 'line/ghi.json'];
        
        beforeEach(function() {
            removeSpy = spyOn(fs, 'remove');
            existsSpy = spyOn(fs, 'existsSync');
        });
        
        it('should exist', function() {
            expect(maint.removeFiles).toBeDefined();
        });
        
        it('should remove a list of files', function() {
            existsSpy.andReturn(true);
            removeSpy.andCallFake(function(fpath, cb) {
                cb(null, 'Success!');
            });
            runs(function() {
                maint.removeFiles(files).then(function(count) {
                    expect(count).toBe(2);
                    expect(removeSpy.calls.length).toBe(2);
                    expect(existsSpy.calls.length).toBe(2);
                    expect(removeSpy.calls[0].args[0]).toBe('abc.mp3');
                    expect(removeSpy.calls[1].args[0]).toBe('line/ghi.json');
                    expect(existsSpy).toHaveBeenCalledWith('abc.mp3');
                    expect(existsSpy).toHaveBeenCalledWith('line/ghi.json');
                    doneFlag = true;
                });
            });
            waitsFor(function() { return doneFlag; }, 3000);
        });
        
        it('should not remove non-existent files', function() {
            existsSpy.andReturn(false);
            runs(function() {
                maint.removeFiles(files).then(function(count) {
                    expect(count).toBe(0);
                    expect(existsSpy.calls.length).toBe(2);
                    expect(removeSpy).not.toHaveBeenCalled();
                    doneFlag = true;
                });
            });
            waitsFor(function() { return doneFlag; }, 3000);
        });
        
        it('should handle errors from deleting files correctly', function() {
            existsSpy.andReturn(true);
            removeSpy.andCallFake(function(fpath, cb) {
                if (fpath === 'abc.mp3') {
                    cb('Error on ' + fpath, null);
                } else {
                    cb(null, 'Success!');
                }
            });
            runs(function() {
                maint.removeFiles(files).catch(function(error) {
                    expect(count).toBe(0);
                    expect(existsSpy.calls.length).toBe(2);
                    expect(removeSpy.calls.length).toBe(2);
                    expect(error).toBe('Error on abc.mp3');
                    doneFlag = true;
                });
            });
            waitsFor(function() { return doneFlag; }, 3000);
        });
    });
    
    describe('resetCollection', function() {
        var db, collection, config;
        
        beforeEach(function() {
            config = {
                mongo: {
                    host: 'fakeHost',
                    port: 666,
                    db: 'fakeDb'
                }
            };
            collection = {
                drop: jasmine.createSpy("coll_drop").andCallFake(function(cb) { cb(); }),
                insert: jasmine.createSpy("coll_insert").andCallFake(function(query, opts, cb) { cb(); })
            };
            db = {
                collection: jasmine.createSpy("db_collection").andReturn(collection),
                collectionNames: jasmine.createSpy("db_cnames").andCallFake(function(query, cb) {
                    cb(null, [query]);
                })
            };
        });
    
        it("should successfully reset a collection with new data", function(done) {
            var data = {
                foo: 'bar'
            };
            maint.resetCollection(db, "users", data, config).then(function() {
                expect(db.collection).toHaveBeenCalledWith('users');
                expect(db.collectionNames).toHaveBeenCalled();
                expect(db.collectionNames.calls[0].args[0]).toBe('users');
                expect(collection.drop).toHaveBeenCalled();
                expect(collection.insert).toHaveBeenCalled();
                expect(collection.insert.calls[0].args[0]).toEqual({foo: 'bar'});
                expect(collection.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it("should be able to fill a collection with multiple records", function(done) {
            var data = [ { foo: 'bar' }, { foo: 'baz' } ];
            maint.resetCollection(db, "users", data, config).then(function() {
                expect(collection.drop).toHaveBeenCalled();
                expect(collection.insert.calls.length).toBe(2);
                expect(collection.insert.calls[0].args[0]).toEqual({foo: 'bar'});
                expect(collection.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(collection.insert.calls[1].args[0]).toEqual({foo: 'baz'});
                expect(collection.insert.calls[1].args[1]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it("should reset a collection with new data even if it did not exist", function(done) {
            db.collectionNames.andCallFake(function(query, cb) {
                cb(null, []);
            });
            var data = {
                foo: 'bar'
            };
            maint.resetCollection(db, "users", data, config).then(function() {
                expect(db.collectionNames).toHaveBeenCalled();
                expect(collection.drop).not.toHaveBeenCalled();
                expect(collection.insert).toHaveBeenCalled();
                expect(collection.insert.calls[0].args[0]).toEqual({foo: 'bar'});
                expect(collection.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it("should not fill a collection with anything if data is not provided", function(done) {
            maint.resetCollection(db, "users", null, config).then(function() {
                expect(collection.drop).toHaveBeenCalled();
                expect(collection.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it("should fail if collection.insert fails", function(done) {
            collection.insert.andCallFake(function(query, opts, cb) {
                cb('Error!');
            });
            var data = {
                foo: 'bar'
            };
            maint.resetCollection(db, "users", data, config).catch(function(error) {
                expect(error).toBe('Error!');
                expect(collection.insert).toHaveBeenCalled();
                done();
            });
        });
    
        it("should fail if collection.drop fails", function(done) {
            collection.drop.andCallFake(function(cb) {
                cb('Error!');
            });
            var data = {
                foo: 'bar'
            };
            maint.resetCollection(db, "users", data, config).catch(function(error) {
                expect(error).toBe('Error!');
                expect(collection.insert).not.toHaveBeenCalled();
                expect(collection.drop).toHaveBeenCalled();
                done();
            });
        });
        
        it("should fail if db.collectionNames fails", function(done) {
            db.collectionNames.andCallFake(function(query, cb) {
                cb('Error!');
            });
            var data = {
                foo: 'bar'
            };
            maint.resetCollection(db, "users", data, config).catch(function(error) {
                expect(error).toBe('Error!');
                expect(db.collectionNames).toHaveBeenCalled();
                expect(collection.insert).not.toHaveBeenCalled();
                expect(collection.drop).not.toHaveBeenCalled();
                done();
            });
        });
    }); // end -- describe resetCollection
}); // end -- describe maint

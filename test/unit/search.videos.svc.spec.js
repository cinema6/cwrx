var flush = true;
describe('search-videos (UT)', function() {
    var searchVideos, mockLog, mockLogger, req, q, logger, requestUtils, anyFunc;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        searchVideos    = require('../../bin/search-videos');

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
            user: { id: 'u1' },
            requester: { id: 'u1', permissions: {} }
        };
        anyFunc = jasmine.any(Function);
    });

    describe('parseDuration', function() {
        it('should return undefined if no duration string is passed in', function() {
            expect(searchVideos.parseDuration(null, 'yt.com/asdf')).toBe(undefined);
            expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it('should properly parse strings of the format "P#Y#M#DT#H#M#S"', function() {
            var durs = [ {str: 'PT1H1M11.23S', val: 3671.23}, {str: 'PT13H34M23S', val: 48863},
                         {str: 'P1Y12M2DT1H23M02S', val: 62817782}, {str: 'P3M', val: 7776000},
                         {str: 'PT3M', val: 180}, {str: 'PT2.45H', val: 8820} ];
            durs.forEach(function(durObj) {
                expect(searchVideos.parseDuration(durObj.str)).toBe(durObj.val);
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it('should properly parse vimeo\'s strings of the format "# (hours|minutes|seconds)"', function() {
            var durs = [{str: '12 mins', val: 720}, {str: '02 mins', val: 120}, {str: '12 minutes', val: 720},
                        {str: '1 hour 2 minutes', val: 3720}, {str: '5 hours 21 mins', val: 19260},
                        {str: '23 seconds', val: 23}, {str: '2 hours 1 second', val: 7201},
                        {str: '1 year', val: 31536000}, {str: '3 days 5 minutes', val: 259500},
                        {str: '2 months 5 seconds', val: 5184005}];
            durs.forEach(function(durObj) {
                expect(searchVideos.parseDuration(durObj.str)).toBe(durObj.val);
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it('should return undefined if the duration is in an unknown format', function() {
            var durs = ['aslkd', 'some mins', 'QT3M1S', 'T4Y', 'TS32', 'P1..3Y', 'PT1HM3S', 'P1YTS3'];
            durs.forEach(function(dur) {
                expect(searchVideos.parseDuration(dur)).toBe(undefined);
            });
            expect(mockLog.warn.calls.count()).toBe(durs.length);
        });
    });

    describe('formatGoogleResults', function() {
        var stats;
        beforeEach(function() {
            stats = { startIndex: 11, count: 20, totalResults: 50 };
            spyOn(searchVideos, 'parseDuration').and.callThrough();
        });

        it('should correctly format youtube results', function() {
            var items = [
                { title: 'YT Test', link: 'http://www.youtube.com/watch?v=GdEKSyad_rk', displayLink: 'www.youtube.com',
                  pagemap: { videoobject: [{description: 'YT desc', duration: 'PT1M13S', height: 1080}],
                             cse_thumbnail: [{width: 300, height: 168, src: 'http://img.com'}] } },
                { title: 'YT Test', link: 'http://m.youtube.com/watch?v=GdEKSyad_rk', displayLink: 'm.youtube.com',
                  pagemap: { videoobject: [{description: 'YT desc', duration: 'PT1M13S', height: 1080}],
                             cse_thumbnail: [{width: 300, height: 168, src: 'http://img.com'}] } }
            ];

            expect(searchVideos.formatGoogleResults(stats, items)).toEqual({
                meta: {skipped: 10, numResults: 20, totalResults: 50},
                items: [
                    { title: 'YT Test', link: 'http://www.youtube.com/watch?v=GdEKSyad_rk', siteLink: 'www.youtube.com',
                      description: 'YT desc', site: 'youtube', hd: true, duration: 73, videoid: 'GdEKSyad_rk',
                      thumbnail: { width: 300, height: 168, src: 'http://img.com' } },
                    { title: 'YT Test', link: 'http://m.youtube.com/watch?v=GdEKSyad_rk', siteLink: 'm.youtube.com',
                      description: 'YT desc', site: 'youtube', hd: true, duration: 73, videoid: 'GdEKSyad_rk',
                      thumbnail: { width: 300, height: 168, src: 'http://img.com' } }
                ]
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it('should correctly format vimeo results', function() {
            var items = [
                { title: 'V Test', link: 'http://vimeo.com/77428778', displayLink: 'vimeo.com',
                  pagemap: { videoobject: [{description: 'V desc', duration: '2 mins', height: 720, thumbnailurl: 'http://thumb.com'}],
                             cse_thumbnail: [{width: 100, height: 100, src: 'http://img2.com'}] } }
            ];

            expect(searchVideos.formatGoogleResults(stats, items)).toEqual({
                meta: { skipped: 10, numResults: 20, totalResults: 50 },
                items: [
                    { title: 'V Test', link: 'http://vimeo.com/77428778', siteLink: 'vimeo.com',
                      description: 'V desc', site: 'vimeo', hd: true, duration: 120, videoid: '77428778',
                      thumbnail: { width: 100, height: 100, src: 'http://img2.com' } }
                ]
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });

        it('should correctly format dailymotion results', function() {
            var items = [
                { title: 'DM Test', link: 'http://www.dailymotion.com/video/x169luh_waterski', displayLink: 'www.dailymotion.com',
                  pagemap: { videoobject: [{description: 'DM desc', duration: 'PT0H1M12S', height: 564, thumbnailurl: 'http://img3.com'}] } }
            ];

            expect(searchVideos.formatGoogleResults(stats, items)).toEqual({
                meta: { skipped: 10, numResults: 20, totalResults: 50 },
                items: [
                    { title: 'DM Test', link: 'http://www.dailymotion.com/video/x169luh_waterski', siteLink: 'www.dailymotion.com',
                      description: 'DM desc', site: 'dailymotion', hd: false, duration: 72, videoid: 'x169luh',
                      thumbnail: { src: 'http://img3.com' } }
                ]
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should log a warning if the site is an unexpected string', function() {
            var items = [
                { title: 'YT Test', link: 'http://www.youtube.com/watch?v=GdEKSyad_rk', displayLink: 'foo.youtube.com',
                  pagemap: { videoobject: [{description: 'YT desc', duration: 'PT1M13S', height: 1080}],
                             cse_thumbnail: [{width: 300, height: 168, src: 'http://img.com'}] } }
            ];

            expect(searchVideos.formatGoogleResults(stats, items)).toEqual({
                meta: {skipped: 10, numResults: 20, totalResults: 50},
                items: [
                    { title: 'YT Test', link: 'http://www.youtube.com/watch?v=GdEKSyad_rk', siteLink: 'foo.youtube.com',
                      description: 'YT desc', site: 'foo.youtube', hd: true, duration: 73,
                      thumbnail: { width: 300, height: 168, src: 'http://img.com' } }
                ]
            });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it('should filter out invalid items received from google', function() {
            stats.count = 6;
            var items = [
                { title: 'Fake 1', displayLink: 'vimeo.com',
                  pagemap: { videoobject: [{description: 'Fake desc', duration: 'PT0H1M12S', height: 564}] } },
                { title: 'Fake 2', displayLink: 'vimeo.com',
                  pagemap: { videoobject: {description: 'Fake desc', duration: 'PT0H1M12S', height: 564} } },
                { title: 'Fake 3', displayLink: 'vimeo.com' }
            ];
            var results = searchVideos.formatGoogleResults(stats, items);
            expect(results.meta).toEqual({skipped: 10, numResults: 6, totalResults: 50});
            expect(results.items).toEqual([]);
            expect(mockLog.warn.calls.count()).toBe(3);
        });

        it('should handle the case where google returns no items', function() {
            stats = { startIndex: 0, count: 0, totalResults: 0 };
            expect(searchVideos.formatGoogleResults(stats)).toEqual({
                meta: {skipped: 0, numResults: 0, totalResults: 0},
                items: []
            });
        });
    });

    describe('findVideosWithGoogle', function() {
        var opts, googleCfg, apiKey;
        beforeEach(function() {
            spyOn(requestUtils, 'qRequest').and.returnValue(q({
                response: { statusCode: 200 },
                body: {
                    queries: { request: [{ startIndex:11, count:20, totalResults:50 }] },
                    items: 'fakeItems'
                }
            }));
            opts = { query: 'foo', limit: 10, start: 20 };
            googleCfg = {apiUrl: 'http://google.com/cse', engineId: 'asdf1234', fields: 'fakeFields'};
            apiKey = 'zxcv5678';
            spyOn(searchVideos, 'formatGoogleResults').and.returnValue('formatted');
        });

        it('should return a 400 if the user is trying to query past the 100th result', function(done) {
            q.all([{limit: 10, start: 92}, {limit: 5, start: 120}, {limit: 1, start: 101}].map(function(params) {
                opts.limit = params.limit;
                opts.start = params.start;
                return searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp).toEqual({code: 400, body: 'Cannot query past first 100 results'});
                });
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
                expect(searchVideos.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should query google for videos', function(done) {
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {url: 'http://google.com/cse',
                    qs: {q: 'foo', cx: 'asdf1234', key: 'zxcv5678', num: 10, start: 20, fields: 'fakeFields'} });
                expect(searchVideos.formatGoogleResults).toHaveBeenCalledWith(
                    { startIndex: 11, count: 20, totalResults: 50 }, 'fakeItems');
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to restrict results to certain sites', function(done) {
            opts.sites = ['youtube.com', 'vimeo.com'];
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                var reqOpts = requestUtils.qRequest.calls.all()[0].args[1];
                expect(reqOpts.qs.q).toBe('foo site:youtube.com OR site:vimeo.com');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to restrict results to only hd videos', function(done) {
            opts.hd = 'true';
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                var reqOpts = requestUtils.qRequest.calls.all()[0].args[1];
                expect(reqOpts.qs.sort).toBe('videoobject-height:r:720');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to restrict results to non hd videos', function(done) {
            opts.hd = 'false';
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                var reqOpts = requestUtils.qRequest.calls.all()[0].args[1];
                expect(reqOpts.qs.sort).toBe('videoobject-height:r::719');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to retry failed requests to google', function(done) {
            requestUtils.qRequest.and.callFake(function(method, opts) {
                if (this.qRequest.calls.count() >= 2) {
                    return q({
                        response: { statusCode: 200 },
                        body: {
                            queries: { request: [{startIndex:11, count:20, totalResults:50 }] },
                            items: 'fakeItems'
                        }
                    });
                } else {
                    return q.reject({error: 'I GOT A PROBLEM'});
                }
            });
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockLog.warn.calls.count()).toBe(1);
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(searchVideos.formatGoogleResults).toHaveBeenCalledWith(
                    { startIndex: 11, count: 20, totalResults: 50 }, 'fakeItems');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should never report that it found more than 100 results', function(done) {
            requestUtils.qRequest.and.returnValue(q({
                response: { statusCode: 200 },
                body: {
                    queries: { request: [{ startIndex:11, count:20, totalResults:500 }] },
                    items: 'fakeItems'
                }
            }));
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(searchVideos.formatGoogleResults).toHaveBeenCalledWith(
                    { startIndex: 11, count: 20, totalResults: 100 }, 'fakeItems');
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 500 code if google returns a non-2xx status code', function(done) {
            q.all([100, 300, 400, 500].map(function(code) {
                requestUtils.qRequest.and.returnValue(q({response: {statusCode: code}, body: 'fake'}));
                return searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey);
            })).then(function(results) {
                results.forEach(function(result) {
                    expect(result).toEqual({code: 500, body: 'Error querying google'});
                });
                expect(mockLog.warn.calls.count()).toBe(8);
                expect(requestUtils.qRequest.calls.count()).toBe(8);
                expect(searchVideos.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 500 code if google returns an incomplete body', function(done) {
            q.all([{items: []}, {queries: 'fake', items: []}]
            .map(function(body) {
                requestUtils.qRequest.and.returnValue(q({response: {statusCode: 200}, body: body}));
                return searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey);
            })).then(function(results) {
                results.forEach(function(result) {
                    expect(result).toEqual({code: 500, body: 'Error querying google'});
                });
                expect(mockLog.warn.calls.count()).toBe(4);
                expect(requestUtils.qRequest.calls.count()).toBe(4);
                expect(searchVideos.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 500 code if the request fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject({error: 'I GOT A PROBLEM'}));
            searchVideos.findVideosWithGoogle(req, opts, googleCfg, apiKey).then(function(resp) {
                expect(resp).toEqual({code: 500, body: 'Error querying google'});
                expect(mockLog.warn.calls.count()).toBe(2);
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(searchVideos.formatGoogleResults).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });

    describe('findVideos', function() {
        var config, secrets;
        beforeEach(function() {
            req.query = {query: 'foo', limit: '10', skip: '20', sites: 'youtube,vimeo', hd: 'true'};
            config = { google: 'fakeGoogleCfg', foo: 'bar' };
            secrets = { googleKey: 'asdf1234', other: 'yes' };
            spyOn(searchVideos, 'findVideosWithGoogle').and.returnValue(q('fakeResp'));
        });

        it('should call findVideosWithGoogle', function(done) {
            searchVideos.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).toBe('fakeResp');
                expect(searchVideos.findVideosWithGoogle).toHaveBeenCalledWith(req,
                    {query: 'foo', limit: 10, start: 21, sites: ['youtube.com', 'vimeo.com'], hd: 'true'},
                    'fakeGoogleCfg', 'asdf1234');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use defaults for some opts if not provided', function(done) {
            req.query = {query: 'foo'};
            searchVideos.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).toBe('fakeResp');
                expect(searchVideos.findVideosWithGoogle).toHaveBeenCalledWith(req,
                    {query: 'foo', limit: 10, start: 1, sites: null, hd: undefined},
                    'fakeGoogleCfg', 'asdf1234');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should guard against invalid values for the limit and skip params', function(done) {
            q.all([['a1', 'a1'], ['-1', '-2'], ['11', '0']].map(function(params) {
                req.query.limit = params[0];
                req.query.skip = params[1];
                return searchVideos.findVideos(req, config, secrets);
            })).then(function(results) {
                results.forEach(function(result, idx) {
                    expect(result).toBe('fakeResp');
                    if (idx === 1) expect(searchVideos.findVideosWithGoogle.calls.all()[idx].args[1].limit).toBe(1);
                    else expect(searchVideos.findVideosWithGoogle.calls.all()[idx].args[1].limit).toBe(10);
                    expect(searchVideos.findVideosWithGoogle.calls.all()[idx].args[1].start).toBe(1);
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if there\'s no query string in the request', function(done) {
            delete req.query.query;
            searchVideos.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'No query in request'});
                expect(searchVideos.findVideosWithGoogle).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if findVideosWithGoogle fails', function(done) {
            searchVideos.findVideosWithGoogle.and.returnValue(q.reject('I GOT A PROBLEM'));
            searchVideos.findVideos(req, config, secrets).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(searchVideos.findVideosWithGoogle).toHaveBeenCalled();
            }).done(done);
        });
    });
});

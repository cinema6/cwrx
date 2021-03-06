#!/usr/bin/env node

var q = require('q');
var request = require('request-promise');
var HTMLDocument = require('../lib/htmlDocument');
var resolveURL = require('url').resolve;
var parseURL = require('url').parse;
var formatURL = require('url').format;
var FunctionCache = require('../lib/functionCache');
var service = require('../lib/service');
var express = require('express');
var logger = require('../lib/logger');
var inherits = require('util').inherits;
var inspect = require('util').inspect;
var BrowserInfo = require('rc-browser-info');
var resolvePath = require('path').resolve;
var inspect = require('util').inspect;
var filterObject = require('../lib/objUtils').filter;
var extend = require('../lib/objUtils').extend;
var clonePromise = require('../lib/promise').clone;
var AdLoader = require('../lib/adLoader');
var parseQuery = require('../lib/expressUtils').parseQuery;
var AWS = require('aws-sdk');
var CloudWatchReporter = require('../lib/cloudWatchReporter');
var cloudwatchMetrics = require('../lib/expressUtils').cloudwatchMetrics;
var setUuid = require('../lib/expressUtils').setUuid;
var setBasicHeaders = require('../lib/expressUtils').setBasicHeaders;
var handleOptions = require('../lib/expressUtils').handleOptions;
var logRequest = require('../lib/expressUtils').logRequest;
var expressErrHandler = require('../lib/expressUtils').errorHandler;
var AppBuilder = require('rc-app-builder');
var fs = require('fs-extra');
var replaceStream = require('replacestream');
var concatStream = require('concat-stream');
var dirname = require('path').dirname;
var _ = require('lodash');
var VAST = require('vastacular').VAST;
var querystring = require('querystring');

var CONTEXTS = {
    STANDALONE: 'standalone',
    MRAID: 'mraid',
    VPAID: 'vpaid',
    EMBED: 'embed'
};

function stripURL(url) {
    var parsed = (url && parseURL(url)) || undefined;

    return parsed && formatURL({
        protocol: parsed.protocol,
        host: parsed.host,
        pathname: parsed.pathname
    });
}

function ServiceError(message, status) {
    Error.call(this, message);

    this.message = message;
    this.status = status;
}
inherits(ServiceError, Error);

ServiceError.prototype.toString = function toString() {
    return '[' + this.status + '] ' + this.message;
};

function Player(config) {
    var log = logger.getLog();
    var playerCache = new FunctionCache({
        freshTTL: Infinity,
        maxTTL: Infinity,
        gcInterval: Infinity,

        extractor: function cloneDocument(promise) {
            return promise.then(function(document) { return document.clone(); });
        }
    });
    var contentCache = new FunctionCache({
        freshTTL: config.api.experience.cacheTTLs.fresh,
        maxTTL: config.api.experience.cacheTTLs.max,
        extractor: clonePromise
    });
    var brandingCache = new FunctionCache({
        freshTTL: config.api.branding.cacheTTLs.fresh,
        maxTTL: config.api.branding.cacheTTLs.max
    });
    var versionCache = new FunctionCache({
        freshTTL: Infinity,
        maxTTL: Infinity,
        gcInterval: Infinity
    });
    var placementCache = new FunctionCache({
        freshTTL: config.api.placement.cacheTTLs.fresh,
        maxTTL: config.api.placement.cacheTTLs.max,
        extractor: clonePromise
    });
    var vastCache = new FunctionCache({
        freshTTL: Infinity,
        maxTTL: Infinity,
        gcInterval: Infinity
    });

    this.config = extend({
        app: {
            builder: (config.app.config || null) && require(config.app.config)
        }
    }, config);
    this.adLoader = new AdLoader({
        envRoot: config.api.root,
        cardEndpoint: config.api.card.endpoint,
        cardCacheTTLs: config.api.card.cacheTTLs,
        trackingPixel: config.tracking.pixel
    });
    this.adLoadTimeReporter = new CloudWatchReporter(config.cloudwatch.namespace, {
        MetricName: 'AdLoadTime',
        Unit: 'Milliseconds',
        Dimensions: config.cloudwatch.dimensions
    });
    this.adLoadTimeReporter.on('flush', function(data) {
        log.info('Sending AdLoadTime metrics to CloudWatch: %1', inspect(data));
    });

    this.adLoadTimeReporter.autoflush(config.cloudwatch.sendInterval);

    // Memoize Player.prototype.getVersion() method.
    this.getVersion = versionCache.add(this.getVersion.bind(this));
    // Memoize Player.prototype.__getPlayer__() method.
    this.__getPlayer__ = playerCache.add(this.__getPlayer__.bind(this), -1);
    // Memoize Player.prototype.__getExperience__() method.
    this.__getExperience__ = contentCache.add(this.__getExperience__.bind(this), -1);
    // Memoize Player.prototype.__getBranding__() method.
    this.__getBranding__ = brandingCache.add(this.__getBranding__.bind(this), -1);
    // Memoize Player.prototype.__getPlacement__() method.
    this.__getPlacement__ = placementCache.add(this.__getPlacement__.bind(this), -1);
    // Memoize Player.prototype.__createVAST__() method.
    this.__createVAST__ = vastCache.add(this.__createVAST__.bind(this), -1);

    //Cache the initial player version.
    this.getVersion();
}

/***************************************************************************************************
 * @private methods * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 **************************************************************************************************/

Player.prototype.__getBuildProfile__ = function __getBuildProfile__(experience, options) {
    var isMiniReel = (experience || null) && experience.data.deck.length > 1;
    var cards = (experience || null) && experience.data.deck;

    return {
        type: options.type,
        context: options.context,

        debug: options.debug > 2,
        secure: options.secure,

        isMiniReel: isMiniReel,
        card: {
            types: cards && _.uniq(cards.map(_.property('type'))).sort(),
            modules: cards && _.uniq(_.flatten(cards.map(_.property('modules')))).sort()
        }
    };
};

Player.prototype.__apiParams__ = function __apiParams__(type, params) {
    var validParams = this.config.api[type].validParams;
    var predicate = validParams ? function(value, key) {
        return validParams.indexOf(key) > -1;
    } : function() { return true; };

    return filterObject(params, predicate);
};

Player.prototype.__loadCard__ = function __loadCard__(params) {
    var self = this;
    var log = logger.getLog();
    var adLoader = this.adLoader;
    var adLoadTimeReporter = this.adLoadTimeReporter;
    var validParams = this.__apiParams__('experience', params);
    var cardId = params.card;
    var campaignId = params.campaign;
    var origin = params.origin;
    var uuid = params.reqUuid;
    var experienceId = this.config.api.experience.default;

    return this.__getExperience__(experienceId, validParams, origin, uuid)
        .catch(function logError(reason) {
            log.error('[%1] Failed to fetch the default experience: %2.', uuid, inspect(reason));
            throw reason;
        })
        .then(function fetch(experience) {
            var cardParams = self.__apiParams__('card', params);
            var cardMeta = extend({ experience: experienceId }, params);

            function fetchCard() {
                var start = Date.now();

                return (function() {
                    if (cardId) {
                        return adLoader.getCard(cardId, cardParams, cardMeta, uuid);
                    }

                    return adLoader.findCard(
                        campaignId, cardParams, cardMeta, uuid
                    ).then(function checkForCard(card) {
                        if (!card) { throw new Error('No cards found.'); }

                        return card;
                    });
                }()).tap(function sendMetrics() {
                    adLoadTimeReporter.push(Date.now() - start);
                }).catch(function createServiceError(reason) {
                    throw new ServiceError(reason.message, 404);
                }).tap(function checkCampaignIdMatches(card) {
                    if (campaignId && card.campaignId !== campaignId) {
                        throw new ServiceError(
                            'Card\'s campaign {' + card.campaignId + '} does not match ' +
                                'specified campaign {' + campaignId + '}.',
                            400
                        );
                    }
                });
            }

            return fetchCard().then(function loadCard(card) {
                experience.data.title = card.title;
                experience.data.deck = [card];

                return experience;
            });
        });
};

Player.prototype.__loadExperience__ = function __loadExperience__(params) {
    var self = this;
    var log = logger.getLog();
    var id = params.experience;
    var origin = params.origin;
    var uuid = params.reqUuid;
    var preview = params.preview;
    var campaign = params.campaign;
    var validParams = this.__apiParams__('experience', params);
    var adLoader = this.adLoader;
    var adLoadTimeReporter = this.adLoadTimeReporter;

    function getExperience() {
        // If in preview mode, call the uncached version of __getExperience__().
        var method = preview ? Player.prototype.__getExperience__ : self.__getExperience__;

        return method.apply(self, arguments);
    }

    function loadAds(experience) {
        var start = Date.now();

        if (!AdLoader.hasAds(experience)) {
            log.trace('[%1] Skipping ad calls.', uuid);
            return AdLoader.removePlaceholders(experience);
        }

        return adLoader.loadAds(experience, campaign, params, uuid)
            .tap(function sendMetrics() {
                adLoadTimeReporter.push(Date.now() - start);
            })
            .catch(function trimCards() {
                AdLoader.removePlaceholders(experience);
                AdLoader.removeSponsoredCards(experience);
            })
            .thenResolve(experience);
    }

    return getExperience(id, validParams, origin, uuid).then(loadAds);
};

Player.prototype.__getPlacement__ = function __getPlacement__(id, params, uuid) {
    var log = logger.getLog();
    var config = this.config;
    var placementLocation = resolveURL(config.api.root, config.api.placement.endpoint);
    var url = resolveURL(placementLocation, id);

    return q(request.get(url, { qs: params, json: true }).catch(function handleRejection(reason) {
        if (reason.name !== 'StatusCodeError') {
            log.error('[%1] Unexpected error fetching placement: {%2}', uuid, inspect(reason));
            throw new ServiceError(reason.message, 500);
        }

        if (reason.statusCode >= 500) {
            log.error(
                '[%1] Bad response fetching placement: [%2] {%3} (%4)',
                uuid, reason.statusCode, inspect(reason), url
            );
        }

        throw new ServiceError(reason.message, reason.statusCode);
    }));
};

Player.prototype.__getExperience__ = function __getExperience__(id, params, origin, uuid) {
    var log = logger.getLog();
    var config = this.config;
    var contentLocation = resolveURL(config.api.root, config.api.experience.endpoint);
    var url = resolveURL(contentLocation, id || '');

    if (!id) {
        return q.reject(new ServiceError('experience must be specified', 400));
    }

    log.trace(
        '[%1] Fetching experience from "%2" with params (%3) as "%4."',
        uuid, url, inspect(params), origin
    );

    return q(request.get(url, {
        qs: params,
        headers: { origin: origin },
        json: true
    })).then(function decorate(experience) {
        return extend(experience, { $params: params });
    }).catch(function convertError(reason) {
        var message = reason.message;
        var statusCode = reason.statusCode;

        if (statusCode >= 500) {
            log.error('[%1] Error fetching experience: [%2] {%3}.', uuid, statusCode, message);
        }

        throw new ServiceError(message, statusCode);
    });
};

Player.prototype.__getBranding__ = function __getBranding__(branding, type, hover, uuid) {
    var log = logger.getLog();
    var base = resolveURL(this.config.api.root, this.config.api.branding.endpoint);
    var directory = resolveURL(base, branding + '/styles/');
    var typeDirectory = resolveURL(directory, type + '/');
    var stylesheets = [
        resolveURL(directory, 'core.css'),
        resolveURL(typeDirectory, 'theme.css')
    ].concat(hover ? [
        resolveURL(directory, 'core--hover.css'),
        resolveURL(typeDirectory, 'theme--hover.css')
    ] : []);

    function fetchBranding(type, src) {
        return request.get(src).then(function createData(contents) {
            log.trace('[%1] Got branding "%2".', uuid, src);

            return { type: type, src: src, contents: contents };
        }).catch(function returnNull(reason) {
            log.trace('[%1] Failed to get stylesheet: %2.', uuid, reason.message);

            return null;
        });
    }

    log.info(
        '[%1] Fetching {%2} branding for player {%3} with hover: %4.',
        uuid, branding, type, hover
    );

    return q.all(stylesheets.map(function(src) {
        return q.all([
            fetchBranding('css', src),
            fetchBranding('js', src + '.domino.js')
        ]);
    })).then(function filterNulls(/*brandings*/) {
        var brandings = _.flatten(arguments[0]);
        var result = brandings.filter(function(branding) { return branding; });

        log.info('[%1] Successfully got %2 branding stylesheets.', uuid, result.length);

        return result;
    });
};

/**
 * Given a player "mode," this method will fetch the player's HTML file, replace any ${mode} macros
 * with the give mode and build the player using rc-app-builder.
 */
Player.prototype.__getPlayer__ = function __getPlayer__(profile, conditional, uuid) {
    var log = logger.getLog();
    var type = profile.type;
    var secure = profile.secure;
    var debug = profile.debug;
    var config = this.config;
    var staticURL = resolveURL(config.api.root, config.app.staticURL + config.app.version + '/');
    var builder = new AppBuilder(extend({
        debug: debug,

        baseDir: dirname(config.app.entry),
        baseURL: (function() {
            var location = parseURL(staticURL);

            return formatURL({
                protocol: secure ? 'https:' : 'http:',
                host: location.host,
                pathname: location.pathname
            });
        }())
    }, config.app.builder));
    var entry = fs.createReadStream(config.app.entry).pipe(replaceStream(/\${mode}/g, type));
    var start = Date.now();

    if (config.validTypes.indexOf(type) < 0) {
        return q.reject(new ServiceError('Unknown player type: ' + type, 404, 'info'));
    }

    if (conditional) {
        builder.config.browserify.transforms.unshift([require.resolve('conditionalify'), {
            ecmaVersion: 6,
            context: profile
        }]);
    }

    log.info('[%1] Building the %2 player.', uuid, type);

    return new q.Promise(function(resolve, reject) {
        builder.on('error', reject);

        builder.build(entry).pipe(concatStream(function createHTMLDocument(data) {
            var document = new HTMLDocument(data.toString());

            log.info(
                '[%1] Finished building the %2 player after %3ms.',
                uuid, type, Date.now() - start
            );

            resolve(document.addResource('build-profile', 'application/json', profile));
        }));
    }).catch(function logRejection(reason) {
        log.error('[%1] Error building the %2 player: %3.', uuid, type, inspect(reason));
        throw reason;
    });
};

Player.prototype.__createVAST__ = function __createVAST__(card, params, origin, uuid) {
    var log = logger.getLog();
    var jsURL = this.config.vast.js;
    var swfURL = this.config.vast.swf;
    var adParams = extend({ apiRoot: this.config.api.root }, params);
    var swfParams = extend({ js: jsURL }, adParams);

    if (card.data.duration < 0) {
        throw new ServiceError('The duration of card {' + card.id + '} is unknown.', 409);
    }

    log.trace('[%1] Creating VAST for card {%2} with params: %3.', uuid, card.id, inspect(params));

    return new VAST({
        version: '2.0',
        ads: [
            {
                id: card.id,
                type: 'inline',
                system: {
                    name: 'Reelcontent Player Service',
                    version: this.config.appVersion
                },
                title: card.title,
                description: card.note,
                impressions: [{
                    uri: this.adLoader.pixelFactory(card, extend({
                        origin: origin
                    }, params))('impression')
                }],
                creatives: [
                    {
                        id: card.id,
                        type: 'linear',
                        duration: card.data.duration,
                        parameters: querystring.stringify(adParams),
                        mediaFiles: [
                            {
                                type: 'swf',
                                uri: swfURL + '?' + querystring.stringify(swfParams),
                                mime: 'application/x-shockwave-flash'
                            },
                            {
                                type: 'js',
                                uri: jsURL,
                                mime: 'application/javascript'
                            }
                        ].map(function(config) {
                            return {
                                id: card.id + '--' + config.type,
                                delivery: 'progressive',
                                type: config.mime,
                                uri: config.uri,
                                width: 640,
                                height: 480,
                                scalable: true,
                                maintainAspectRatio: true,
                                apiFramework: 'VPAID'
                            };
                        })
                    }
                ]
            }
        ]
    }).toXML();
};

/***************************************************************************************************
 * @public methods * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 **************************************************************************************************/

module.exports = Player;

Player.startService = function startService() {
    var Player = this;
    var state = {
        defaultConfig: {
            appName: 'player',
            appDir: __dirname,
            pidDir: resolvePath(__dirname, '../pids'),
            api: {
                root: 'http://localhost/',
                branding: {
                    endpoint: 'collateral/branding/',
                    cacheTTLs: {
                        fresh: 15,
                        max: 30
                    }
                },
                player: {
                    endpoint: 'apps/mini-reel-player/index.html'
                },
                experience: {
                    endpoint: 'api/public/content/experience/',
                    validParams: [
                        'campaign', 'branding', 'preview'
                    ],
                    cacheTTLs: {
                        fresh: 1,
                        max: 5
                    },
                    default: 'e-00000000000000'
                },
                card: {
                    endpoint: 'api/public/content/cards/',
                    validParams: [
                        'preview'
                    ],
                    cacheTTLs: {
                        fresh: 1,
                        max: 5
                    }
                },
                placement: {
                    endpoint: 'api/public/placements/',
                    validParams: [],
                    cacheTTLs: {
                        fresh: 1,
                        max: 5
                    }
                }
            },
            tracking: {
                pixel: '//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif'
            },
            vast: {
                js: 'https://s3.amazonaws.com/c6.dev/ext/c6embed/v1/vpaid.min.js',
                swf: 'https://s3.amazonaws.com/c6.dev/ext/c6embed/v1/vpaid.swf'
            },
            app: {
                version: 'master'
            },
            precache: {
                concurrency: 2,
                profiles: []
            },
            cloudwatch: {
                namespace: 'C6/Player',
                region: 'us-east-1',
                sendInterval: (5 * 60 * 1000), // 5 mins
                dimensions: [{ Name: 'Environment', Value: 'Development' }]
            },
            defaults: {
                origin: 'http://www.cinema6.com/',
                context: CONTEXTS.STANDALONE,
                container: 'standalone',
                mobileType: 'mobile',
                standalone: true
            },
            validTypes: [
                'full-np', 'solo', 'desktop-card',
                'light',
                'lightbox',
                'mobile'
            ],
            typeRedirects: {
                'lightbox-playlist': 'lightbox',
                'full': 'full-np',
                'solo-ads': 'solo',
                'swipe': 'mobile'
            }
        }
    };

    function route(state) {
        var log = logger.getLog();
        var started = new Date();
        var app = express();
        var player = new Player(state.config);
        var parsePlayerQuery = parseQuery({
            arrays: ['categories', 'playUrls', 'countUrls', 'clickUrls', 'launchUrls']
        });
        var sendMetrics = cloudwatchMetrics(
            state.config.cloudwatch.namespace,
            state.config.cloudwatch.sendInterval,
            { Dimensions: state.config.cloudwatch.dimensions }
        );

        function resetCodeCache() {
            log.info('Got refresh command. Resetting code cache.');

            return player.resetCodeCache();
        }

        app.set('trust proxy', 1);

        app.use(setUuid());
        app.use(setBasicHeaders());
        app.use(handleOptions());
        app.use(logRequest('trace'));

        app.get('/api/players/meta', function(req, res) {
            return player.getVersion().then(function sendResponse(playerVersion) {
                return res.send(200, {
                    playerVersion: playerVersion,
                    serviceVersion: state.config.appVersion,
                    started : started.toISOString(),
                    status : 'OK'
                });
            }).catch(function sendError(error) {
                var message = inspect(error);

                log.error('[%1] Failed to get service metadata: %2', req.uuid, message);

                return res.send(500, message);
            });
        });

        app.get('/api/players/version', function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.get('/api/public/vast/2.0/tag', sendMetrics, function setHeaders(req, res, next) {
            var maxAge = player.config.api.card.cacheTTLs.fresh * 60;
            var origin = req.get('Origin');

            res.set('Content-Type', 'application/xml');

            if (origin) {
                res.set({
                    'Access-Control-Allow-Origin': origin,
                    'Access-Control-Allow-Credentials': 'true'
                });
            }

            if (req.query.card) {
                res.set('Cache-Control', 'max-age=' + maxAge);
            }

            next();
        }, player.middlewareify('getVAST'));

        app.get(
            '/api/public/player',
            parsePlayerQuery, sendMetrics, player.middlewareify('getViaPlacement')
        );

        app.get('/api/public/players/:type', parsePlayerQuery, sendMetrics, function redirect(
            req,
            res,
            next
        ) {
            var config = state.config;
            var type = req.params.type;
            var uuid = req.uuid;
            var query = req.query;
            var mobileType = query.mobileType || config.defaults.mobileType;
            var typeRedirect = config.typeRedirects[type];
            var agent = req.get('user-agent');
            var browser = new BrowserInfo(agent);

            if (typeRedirect) {
                log.trace('[%1] Redirecting agent from %2 to %3 player.', uuid, type, typeRedirect);
                return res.redirect(301, typeRedirect + formatURL({ query: req.query }));
            }

            if (browser.isMobile && type !== mobileType) {
                log.trace('[%1] Redirecting agent to mobile player: %2.', uuid, mobileType);
                return res.redirect(303, mobileType + formatURL({ query: req.query }));
            }

            return next();
        }, player.middlewareify('get'));

        app.use(expressErrHandler());

        process.on('SIGUSR2', resetCodeCache);
        process.on('message', function(message) {
            switch (message.cmd) {
            case 'refresh':
                return resetCodeCache();
            default:
                return;
            }
        });

        player.precache();

        app.listen(state.cmdl.port);
        log.info('Service is listening on port: %1', state.cmdl.port);

        return app;
    }

    return service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(function init(state) {
            var log = logger.getLog();

            if (state.clusterMaster) {
                log.info('Cluster master, not a worker');

                process.on('SIGUSR2', function refreshKids() {
                    log.info('Cluster master got SIGUSR2. Refreshing kids.');

                    state.kids.forEach(function refreshKid(kid) {
                        kid.send({ cmd: 'refresh' });
                    });
                });

                return state;
            }

            AWS.config.update({ region: state.config.cloudwatch.region });

            return route(state);
        });
};

Player.prototype.precache = function precache() {
    var self = this;
    var log = logger.getLog();
    var concurrency = this.config.precache.concurrency;
    var profiles = this.config.precache.profiles;

    function doBuild(start, players) {
        var end = start + concurrency;
        var chunk = profiles.slice(start, end);

        if (chunk.length === 0) {
            return q(players);
        }

        return q.all(chunk.map(function(profile) {
            return self.__getPlayer__(profile, profile.card.types !== null, null);
        })).then(function recurse(newPlayers) {
            return doBuild(end, players.concat(newPlayers));
        });
    }

    log.info('Pre-caching %1 players.', profiles.length);

    return doBuild(0, []).tap(function logSuccess() {
        log.info('Finished building %1 players.', profiles.length);
    }).catch(function logError(reason) {
        log.error('Failed to pre-cache players: %1', inspect(reason));

        throw reason;
    });
};

Player.prototype.middlewareify = function middlewareify(method) {
    var self = this;
    var log = logger.getLog();

    return function middleware(req, res) {
        var uuid = req.uuid;
        var browser = new BrowserInfo(req.get('user-agent'));
        var options = extend(extend({
            reqUuid: uuid,
            origin: stripURL(req.get('origin') || req.get('referer')),
            desktop: browser.isDesktop,
            mobile: browser.isMobile,
            secure: req.secure,
            $params: req.query
        }, req.query), req.params);

        self[method](options).then(function sendResponse(result) {
            log.info('[%1] {GET %2} Response Length: %3.', uuid, req.url, result.length);
            return res.send(200, result);
        }).catch(function handleRejection(reason) {
            var status = (reason && reason.status) || 500;
            var message = (reason && reason.message) || 'Internal error';

            if (reason instanceof ServiceError) {
                log.info('[%1] Failure: {%2} %3', uuid, status, message);
            } else {
                log.error('[%1] Failure: {%2} %3 [%4]', uuid, status, inspect(reason), req.url);
            }

            res.send(status, message);
        });
    };
};

Player.prototype.getVersion = function getVersion() {
    return q(this.config.app.version);
};

Player.prototype.get = function get(/*options*/) {
    var options = extend(arguments[0], this.config.defaults);

    var log = logger.getLog();
    var self = this;
    var type = options.type;
    var desktop = options.desktop;
    var uuid = options.reqUuid;
    var playUrls = options.playUrls;
    var countUrls = options.countUrls;
    var clickUrls = options.clickUrls;
    var launchUrls = options.launchUrls;
    var experience = options.experience;
    var card = options.card;
    var campaign = options.campaign;
    var embed = options.embed;
    var branding = options.branding;
    var countdown = options.countdown;
    var prebuffer = !!options.prebuffer;

    log.trace('[%1] Getting player with options (%2.)', uuid, inspect(options));

    function getPlayer(experience) {
        var profile = self.__getBuildProfile__(experience, options);

        return self.__getPlayer__(profile, !!experience, uuid).then(function inlineOpt(document) {
            log.trace('[%1] Adding options (%2) to player HTML.', uuid, inspect(options));
            return document.addResource('options', 'application/json', options);
        });
    }

    function setupExperience(experience) {
        experience.data.deck.forEach(function setupCard(card) {
            if (AdLoader.isSponsored(card)) {
                AdLoader.addTrackingPixels({
                    playUrls: playUrls,
                    countUrls: countUrls,
                    clickUrls: clickUrls,
                    launchUrls: launchUrls
                }, card);

                if (countdown !== undefined) {
                    card.data.skip = countdown;
                }
            }

            card.data.prebuffer = prebuffer;
        });

        return experience;
    }

    function loadBranding(branding) {
        var promise = (function() {
            if (!branding) {
                log.trace('[%1] branding is %2. Skipping branding load.', uuid, branding);
                return q([]);
            }

            return self.__getBranding__(branding, type, desktop, uuid);
        }());

        return function inlineBranding(document) {
            return promise.then(function add(items) {
                items.forEach(function addBrandingCSS(branding) {
                    var contentType = branding.type;
                    var src = branding.src;
                    var contents = branding.contents;

                    log.trace(
                        '[%1] Inlining branding %2 (%3) into %4 player HTML.',
                        uuid, contentType, src, type
                    );

                    switch (contentType) {
                    case 'css':
                        return document.addCSS(src, contents);
                    case 'js':
                        return document.addJS(src, contents);
                    }
                });

                return document;
            });
        };
    }

    function stringify(document) {
        log.trace('[%1] Stringifying document.', uuid);
        return document.toString();
    }

    if (!(experience || card || campaign)) {
        if (embed) {
            return getPlayer().then(loadBranding(branding)).then(stringify);
        }

        return q.reject(new ServiceError(
            'You must specify either an experience, card or campaign.', 400
        ));
    }

    if (experience && card) {
        return q.reject(new ServiceError(
            'You may specify an experience or card, not both.', 400
        ));
    }

    return (
        experience ? this.__loadExperience__(options) : this.__loadCard__(options)
    ).then(function processExperience(experience) {
        var branding = experience.data.branding;

        if (experience.data.deck.length < 1) {
            throw new ServiceError('Experience {' + experience.id + '} has no cards.', 409);
        }

        if (options.vpaid && experience.data.deck.length > 1) {
            throw new ServiceError('VPAID does not support MiniReels.', 400);
        }

        setupExperience(experience);

        return getPlayer(experience).then(loadBranding(branding)).then(function add(document) {
            log.trace('[%1] Adding experience (%2) to %3 player HTML.', uuid, experience.id, type);
            return document.addResource('experience', 'application/json', experience);
        });
    }).then(stringify);
};

Player.prototype.getViaPlacement = function getViaPlacement(options) {
    var log = logger.getLog();
    var self = this;
    var config = this.config;
    var uuid = options.reqUuid;
    var placement = options.placement;

    if (!placement) {
        return q.reject(new ServiceError('You must provide a placement.', 400));
    }

    log.trace('[%1] Fetching placement {%2}.', uuid, placement);

    return this.__getPlacement__(placement, {}, uuid).then(function getPlayer(placement) {
        var params = _.defaults(_.assign(placement.tagParams, options), config.defaults);

        if (options.mobile) {
            params.type = params.mobileType;
        }

        log.trace('[%1] Got placement. Getting player with options: %2.', uuid, inspect(params));

        return self.get(params);
    });
};

Player.prototype.getVAST = function getVAST(options) {
    var self = this;
    var log = logger.getLog();
    var adLoader = this.adLoader;
    var uuid = options.reqUuid;
    var origin = options.origin;
    var placement = options.placement;
    var card = options.card;
    var campaign = options.campaign;

    if (!(placement || card || campaign)) {
        return q.reject(new ServiceError('You must specify a placement, card or campaign.', 400));
    }

    log.trace('[%1] Making VAST with options (%2).', uuid, inspect(options));

    return (function getOptions() {
        if (!placement) {
            log.trace('[%1] No placement, using only query params.', uuid);
            return q(options);
        }

        return self.__getPlacement__(placement, {}, origin, uuid).then(function combine(placement) {
            var tagParams = placement.tagParams;
            var queryParams = options.$params;

            log.trace(
                '[%1] Got placement {%2} with tagParams (%2).',
                uuid, placement.id, inspect(tagParams)
            );

            return _.assign({}, options, { $params: _.assign({}, tagParams, queryParams) });
        });
    }()).then(function fetchCard(options) {
        var params = options.$params;
        var cardParams = self.__apiParams__('card', params);
        var campaign = params.campaign;
        var card = params.card;

        return (function getCard() {
            if (card) {
                log.trace('[%1] Getting card {%2}.', uuid, card);
                return adLoader.getCard(card, cardParams, options, uuid);
            }

            log.trace('[%1] Finding card rom campaign {%2}.', uuid, campaign);

            return adLoader.findCard(campaign, cardParams, options, uuid).then(function(card) {
                if (!card) {
                    throw new Error('No card was found for campaign {' + campaign + '}.');
                } else {
                    return card;
                }
            });
        }()).catch(function fail(reason) {
            throw new ServiceError(reason.message, 404);
        }).then(function createVAST(card) {
            return self.__createVAST__(card, _.assign({}, params, { card: card.id }), origin, uuid);
        });
    });
};

Player.prototype.resetCodeCache = function resetCodeCache() {
    this.__getPlayer__.clear();
    this.getVersion.clear();
};

module.exports = Player;

if (require.main === module) {
    Player.startService();
}

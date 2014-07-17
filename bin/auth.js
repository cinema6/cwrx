#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path        = require('path'),
        q           = require('q'),
        bcrypt      = require('bcrypt'),
        crypto      = require('crypto'),
        aws         = require('aws-sdk'),
        logger      = require('../lib/logger'),
        uuid        = require('../lib/uuid'),
        mongoUtils  = require('../lib/mongoUtils'),
        authUtils   = require('../lib/authUtils')(),
        service     = require('../lib/service'),
        enums       = require('../lib/enums'),
        email       = require('../lib/email'),
        Status      = enums.Status,

        state       = {},
        auth = {}; // for exporting functions to unit tests

    state.name = 'auth';
    // This is the template for auth's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/auth/caches/run/'),
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            minAge: 60*1000, // TTL for cookies for unauthenticated users
            mongo: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        cacheTTLs: {  // units here are minutes
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
        },
        ses: {
            region: 'us-east-1',
            sender: 'support@cinema6.com'
        },
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        host            : 'localhost',  // hostname of this api server, for constructing urls
        resetTokenTTL   : 1*60*60*1000, // 1 hour; unit here is milliseconds
        secretsPath     : path.join(process.env.HOME,'.auth.secrets.json')
    };

    auth.login = function(req, users, maxAge) {
        if (!req.body || !req.body.email || !req.body.password) {
            return q({
                code: 400,
                body: 'You need to provide an email and password in the body'
            });
        }
        var deferred = q.defer(),
            log = logger.getLog(),
            userAccount;

        log.info('[%1] Starting login for user %2', req.uuid, req.body.email);
        q.npost(users, 'findOne', [{email: req.body.email}])
        .then(function(account) {
            if (!account) {
                log.info('[%1] Failed login for user %2: unknown email', req.uuid, req.body.email);
                return deferred.resolve({code: 401, body: 'Invalid email or password'});
            }
            userAccount = account;
            return q.npost(bcrypt, 'compare', [req.body.password, userAccount.password])
            .then(function(matching) {
                if (matching) {
                    if (account.status !== Status.Active) {
                        log.info('[%1] Failed login for user %2: account status is %3',
                                 req.uuid, req.body.email, account.status);
                        return deferred.resolve({code: 403, body: 'Account not active'});
                    }
                    log.info('[%1] Successful login for user %2', req.uuid, req.body.email);
                    var user = mongoUtils.safeUser(userAccount);
                    return q.npost(req.session, 'regenerate').then(function() {
                        req.session.user = user.id;
                        req.session.cookie.maxAge = maxAge;
                        return deferred.resolve({
                            code: 200,
                            body: user
                        });
                    });
                } else {
                    log.info('[%1] Failed login for user %2: invalid password',
                             req.uuid, req.body.email);
                    return deferred.resolve({code: 401, body: 'Invalid email or password'});
                }
            });
        }).catch(function(error) {
            log.error('[%1] Error logging in user %2: %3', req.uuid, req.body.email, error);
            deferred.reject(error);
        });

        return deferred.promise;
    };

    auth.logout = function(req) {
        var deferred = q.defer(),
            log = logger.getLog();
        log.info('[%1] Starting logout for %2', req.uuid, req.sessionID);
        if (!req.session || !req.session.user) {
            log.info('[%1] User with sessionID %2 attempting to logout but is not logged in',
                     req.uuid, req.sessionID);
            deferred.resolve({code: 204});
        } else {
            log.info('[%1] Logging out user %2 with sessionID %3',
                     req.uuid, req.session.user, req.sessionID);
            q.npost(req.session, 'destroy').then(function() {
                deferred.resolve({code: 204});
            }).catch(function(error) {
                log.error('[%1] Error logging out user %2: %3',
                    req.uuid, req.session.user, error);
                deferred.reject(error);
            });
        }
        return deferred.promise;
    };
    
    auth.notifyForgotPassword = function(sender, recipient, url) {
        var subject = 'Reset your Cinema6 Password',
            data = {url: url};
        return email.compileAndSend(sender, recipient, subject, 'pwdReset.html', data);
    };
    
    auth.forgotPassword = function(req, users, resetTokenTTL, emailSender, host) {
        var log = logger.getLog(),
            now = new Date(),
            reqEmail = req.body && req.body.email || '',
            token;
        
        if (!reqEmail) {
            log.info('[%1] No email in the request body', req.uuid);
            return q({code: 400, body: 'Need to provide email in the request'});
        }
        
        log.info('[%1] User %2 forgot their password, sending reset code', req.uuid, reqEmail);
        
        return q.npost(users, 'findOne', [{email: reqEmail}])
        .then(function(account) {
            if (!account) {
                log.info('[%1] No user with email %2 exists', req.uuid, reqEmail);
                return q({code: 404, body: 'That user does not exist'});
            }

            return q.npost(crypto, 'randomBytes', [24])
            .then(function(buff) {
                token = buff.toString('hex');
                return q.npost(bcrypt, 'hash', [token, bcrypt.genSaltSync()]);
            })
            .then(function(hashed) {
                var updates = {
                    $set: {
                        lastUpdated: now,
                        resetToken: {token:hashed, expires:new Date(now.valueOf() + resetTokenTTL)}
                    }
                };
                return q.npost(users, 'update', [{email:reqEmail}, updates, {w:1, journal:true}]);
            })
            .then(function() { //TODO: fix url to a link to frontend
                log.info('[%1] Saved reset token for %2 to database', req.uuid, reqEmail);
                var url = 'https://' + host + '/api/auth/reset/' + account.id + '/' + token;
                return auth.notifyForgotPassword(emailSender, reqEmail, url);
            })
            .then(function() {
                log.info('[%1] Successfully sent reset email to %2', req.uuid, reqEmail);
                return q({code: 200, body: 'Successfully generated reset token'});
            });
        })
        .catch(function(error) {
            log.error('[%1] Error generating reset token for %2: %3', req.uuid, reqEmail, error);
            return q.reject(error);
        });
    };
    
    auth.resetPassword = function(req, users, emailSender) {
        var log = logger.getLog(),
            id = req.body && req.body.id || '', // TODO: decide exact source for all these params
            token = req.body && req.body.token || '',
            newPassword = req.body && req.body.newPassword || '',
            now = new Date();
        
        if (!id || !token || !newPassword) {
            log.info('[%1] Incomplete reset password request %2',
                     req.uuid, id ? 'for user ' + id : '');
            return q({code: 400, body: 'Must provide id, token, and newPassword'});
        }
        
        log.info('[%1] User %2 attempting to reset their password', req.uuid, id);
        
        return q.npost(users, 'findOne', [{id: id}])
        .then(function(account) {
            if (!account) {
                log.info('[%1] No user with id %2 exists', req.uuid, id);
                return q({code: 404, body: 'That user does not exist'});
            }
            if (!account.resetToken || !account.resetToken.expires) {
                log.info('[%1] User %2 has no reset token in the database', req.uuid, id);
                return q({code: 403, body: 'No reset token found'});
            }
            if (now > account.resetToken.expires) {
                log.info('[%1] Reset token for user %2 expired at %3',
                         req.uuid, id, account.resetToken.expires);
                return q({code: 403, body: 'Reset token expired'});
            }
            return q.npost(bcrypt, 'compare', [token, account.resetToken.token])
            .then(function(matching) {
                if (!matching) {
                    log.info('[%1] Request token does not match reset token in db', req.uuid);
                    return q({code: 403, body: 'Invalid reset token'});
                }
                
                return q.npost(bcrypt, 'hash', [newPassword, bcrypt.genSaltSync()])
                .then(function(hashed) {
                    var updates = {
                        $set: { password: hashed, lastUpdated: now },
                        $unset: { resetToken: 1 }
                    };
                    return q.npost(users, 'update', [{id: id}, updates, {w: 1, journal: true}]);
                }).then(function() {
                    log.info('[%1] User %2 successfully reset their password', req.uuid, id);
                    
                    email.notifyPwdChange(emailSender, account.email)
                    .then(function() {
                        log.info('[%1] Notified user of change at %2', req.uuid, account.email);
                    }).catch(function(error) {
                        log.error('[%1] Error sending msg to %2: %3',req.uuid,account.email,error);
                    });
                    
                    return q({code: 200, body: 'Successfully reset password'});
                });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error resetting password for user %2: %3', req.uuid, id, error);
            return q.reject(error);
        });
    };

    auth.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var express     = require('express'),
            app         = express(),
            users       = state.dbs.c6Db.collection('users'),
            authTTLs    = state.config.cacheTTLs.auth;
        authUtils = require('../lib/authUtils')(authTTLs.freshTTL, authTTLs.maxTTL, users);
        
        aws.config.region = state.config.ses.region;

        app.use(express.bodyParser());
        app.use(express.cookieParser(state.secrets.cookieParser || ''));
        
        var sessions = express.session({
            key: state.config.sessions.key,
            cookie: {
                httpOnly: false,
                maxAge: state.config.sessions.minAge
            },
            store: state.sessionStore
        });
        
        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');
            authUtils._cache._coll = users;
            log.info('Recreated collections from restarted c6Db');
        });
        
        state.dbStatus.sessions.on('reconnected', function() {
            sessions = express.session({
                key: state.config.sessions.key,
                cookie: {
                    httpOnly: false,
                    maxAge: state.config.sessions.minAge
                },
                store: state.sessionStore
            });
            log.info('Recreated session store from restarted db');
        });

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessionsWrapper(req, res, next) {
            sessions(req, res, next);
        }
        
        app.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        app.all('*', function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);
            if (    !req.headers['user-agent'] ||
                    !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });

        app.post('/api/auth/login', sessionsWrapper, function(req, res) {
            auth.login(req, users, state.config.sessions.maxAge).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error processing login'
                });
            });
        });

        app.post('/api/auth/logout', sessionsWrapper, function(req, res) {
            auth.logout(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error processing logout'
                });
            });
        });

        var authGetUser = authUtils.middlewarify({});
        app.get('/api/auth/status', sessionsWrapper, authGetUser, function(req, res) {
            res.send(200, req.user); // errors handled entirely by authGetUser
        });
        
        app.post('/api/auth/password/forgot', function(req, res) { //TODO: put these in org service?
            auth.forgotPassword(req, users, state.config.resetTokenTTL, state.config.ses.sender,
                                state.config.host)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error generating reset code'
                });
            });
        });
        
        app.post('/api/auth/password/reset', function(req, res) {
            auth.resetPassword(req, users, state.config.ses.sender).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error resetting password'
                });
            });
        });

        app.get('/api/auth/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/auth/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.use(function(err, req, res, next) {
            if (err) {
                log.error('Error: %1', err);
                res.send(500, 'Internal error');
            } else {
                next();
            }
        });

        app.listen(state.cmdl.port);
        log.info('Service is listening on port: ' + state.cmdl.port);

        return state;
    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(service.initMongo)
        .then(service.initSessionStore)
        .then(auth.main)
        .catch(function(err) {
            var log = logger.getLog();
            console.log(err.message || err);
            log.error(err.message || err);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        }).done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = auth;
    }
}());

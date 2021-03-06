# Geo Service Changelog

### 1.1.3 Mon Aug  1 10:02:35 EDT 2016
* Transition to the updated method of signing authenticated app requests: [#983](https://github.com/cinema6/cwrx/pull/983)

### 1.1.2 Mon Jul 25 13:50:07 EDT 2016
* [FIX]: Fix for an issue that prevented making app authenticated requests with query parameters containing '!': [#978](https://github.com/cinema6/cwrx/pull/978)

### 1.1.1: Tue Mar 15 19:44:01 EDT 2016
* [FIX]: Fix characters of uuids to be url-safe: [#822](https://github.com/cinema6/cwrx/pull/822)
* Extra deployment steps:
    * Search through existing ids and convert '~' to '-' and '!' to '_'

### 1.1.0: Tue Mar  1 10:37:56 EST 2016
* Update UUIDs: [#768](https://github.com/cinema6/cwrx/issues/768)
* [FEATURE]: Support app authentication: [#798](https://github.com/cinema6/cwrx/pull/798)
* Extra deployment steps: None

### 1.0.0: Thu Feb 11 16:34:45 EST 2016
* Initial commit of geo service: [#786](https://github.com/cinema6/cwrx/issues/786)
* Extra deployment steps: [#788](https://github.com/cinema6/cwrx/issues/788)

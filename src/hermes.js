/*global XDomainRequest:false */

const TraceKit = require('../vendor/TraceKit/tracekit');
const JankMonitor = require('../vendor/performance/jank-monitor');
const stringify = require('../vendor/json-stringify-safe/stringify');
const md5 = require('../vendor/md5/md5');
const aes = require('../vendor/aes/aes');
const pageView = require('../vendor/pv/pv');
// const HermesConfigError = require('./configError');

const utils = require('./utils');
const isErrorEvent = utils.isErrorEvent;
const isDOMError = utils.isDOMError;
const isDOMException = utils.isDOMException;
const isError = utils.isError;
const isObject = utils.isObject;
const isPlainObject = utils.isPlainObject;
const isUndefined = utils.isUndefined;
const isFunction = utils.isFunction;
const isArray = utils.isArray;
const isEmptyObject = utils.isEmptyObject;
const each = utils.each;
const objectMerge = utils.objectMerge;
const truncate = utils.truncate;
const objectFrozen = utils.objectFrozen;
const hasKey = utils.hasKey;
const joinRegExp = utils.joinRegExp;
const uuid4 = utils.uuid4;
const htmlTreeAsString = utils.htmlTreeAsString;
const isSameException = utils.isSameException;
const isSameStacktrace = utils.isSameStacktrace;
const parseUrl = utils.parseUrl;
const fill = utils.fill;
const supportsFetch = utils.supportsFetch;
const supportsReferrerPolicy = utils.supportsReferrerPolicy;
const serializeKeysForMessage = utils.serializeKeysForMessage;
const serializeException = utils.serializeException;
const sanitize = utils.sanitize;

const wrapConsoleMethod = require('./console').wrapMethod;
/*
const dsnKeys = 'source protocol user pass host port path'.split(' '),
    dsnPattern = /^(?:(\w+):)?\/\/(?:(\w+)(:\w+)?@)?([\w\.-]+)(?::(\d+))?(\/.*)/;
*/
function now() {
    return +new Date();
}

// This is to be defensive in environments where window does not exist (see https://github.com/getsentry/raven-js/pull/785)
const _window = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
const _document = _window.document;
const _navigator = _window.navigator;

function keepOriginalCallback(original, callback) {
    return isFunction(callback)
        ? function(data) {
            return callback(data, original);
        }
        : callback;
}

// First, check for JSON support
// If there is no JSON, we no-op the core features of Hermes
// since JSON is required to encode the payload
function Hermes() {
    this._hasJSON = !!(typeof JSON === 'object' && JSON.stringify);
    // Hermes can run in contexts where there's no document (react-native)
    this._hasDocument = !isUndefined(_document);
    this._hasNavigator = !isUndefined(_navigator);
    this._lastCapturedException = null;
    this._lastData = null;
    this._lastEventId = null;
    this._globalServer = 'https://apollo-kl.netease.com';
    // this._globalProject = null;
    this._globalContext = {};
    this._globalOptions = {
        headers: {
            'content-type': 'application/json;charset=UTF-8'
        },
        enable: true,
        appKey: 0,
        logger: 'javascript',
        ignoreErrors: [],
        ignoreUrls: [],
        whitelistUrls: [],
        includePaths: [],
        collectWindowErrors: true,
        captureUnhandledRejections: true,
        maxMessageLength: 0,
        // By default, truncates URL values to 250 chars
        maxUrlLength: 250,
        stackTraceLimit: 50,
        autoBreadcrumbs: true,
        instrument: true,
        sampleRate: 1,
        sanitizeKeys: [],
        monitorJank: false,
        performanceTiming: true,
        pv: true
    };
    this._fetchDefaults = {
        method: 'POST',
        // Despite all stars in the sky saying that Edge supports old draft syntax, aka 'never', 'always', 'origin' and 'default
        // https://caniuse.com/#feat=referrer-policy
        // It doesn't. And it throw exception instead of ignoring this parameter...
        // REF: https://github.com/getsentry/raven-js/issues/1233
        referrerPolicy: supportsReferrerPolicy() ? 'origin' : ''
    };
    this._ignoreOnError = 0;
    this._isHermesInstalled = false;
    this._originalErrorStackTraceLimit = Error.stackTraceLimit;
    // capture references to window.console *and* all its methods first
    // before the console plugin has a chance to monkey patch
    this._originalConsole = _window.console || {};
    this._originalConsoleMethods = {};
    this._plugins = [];
    this._startTime = now();
    this._wrappedBuiltIns = [];
    this._breadcrumbs = [];
    this._lastCapturedEvent = null;
    this._keypressTimeout;
    this._location = _window.location;
    this._lastHref = this._location && this._location.href;
    this._resetBackoff();

    // eslint-disable-next-line guard-for-in
    for (let method in this._originalConsole) {
        this._originalConsoleMethods[method] = this._originalConsole[method];
    }
}

/*
 * The core Hermes singleton
 *
 * @this {Hermes}
 */

Hermes.prototype = {
    // Hardcode version string so that hermes source can be loaded directly via
    // webpack (using a build step causes webpack #1617). Grunt verifies that
    // this value matches package.json during build.
    //   See: https://github.com/getsentry/raven-js/issues/465
    VERSION: '0.3.2',

    debug: process.env.NODE_ENV === 'development',

    TraceKit, // alias to TraceKit

    /*
     * Configure Hermes with a Username and extra options
     *
     * @param {string} Username
     * @param {object} options Set of global options [optional]
     * @return {Hermes}
     */
    config(username, options = {}) {
        let self = this;
        /*
        if (self._globalServer) {
            this._logDebug('error', 'Error: Hermes has already been configured');
            return self;
        }
        */
        if (!username) {
            this._logDebug('warn', 'Warn: username should be configured');
        }

        let globalOptions = self._globalOptions;

        if (!options.hasOwnProperty('enable')) {
            options.enable = 'pass';
        }

        // merge in options
        if (options) {
            each(options, (key, value) => {
                // tags and extra are special and need to be put into context
                if (key === 'tags' || key === 'extra' || key === 'user') {
                    self._globalContext[key] = value;
                } else {
                    globalOptions[key] = value;
                }
            });
        }

        self.setUsername(username);

        // "Script error." is hard coded into browsers for errors that it can't read.
        // this is the result of a script being pulled in from an external domain and CORS.
        globalOptions.ignoreErrors.push(/^Script error\.?$/);
        globalOptions.ignoreErrors.push(/^Javascript error: Script error\.? on line 0$/);

        // join regexp rules into one big rule
        globalOptions.ignoreErrors = joinRegExp(globalOptions.ignoreErrors);
        globalOptions.ignoreUrls = globalOptions.ignoreUrls.length ? joinRegExp(globalOptions.ignoreUrls) : false;
        globalOptions.whitelistUrls = globalOptions.whitelistUrls.length ? joinRegExp(globalOptions.whitelistUrls) : false;
        globalOptions.includePaths = joinRegExp(globalOptions.includePaths);
        globalOptions.maxBreadcrumbs = Math.max(0, Math.min(globalOptions.maxBreadcrumbs || 100, 100)); // default and hard limit is 100

        let autoBreadcrumbDefaults = {
            xhr: true,
            console: true,
            dom: true,
            location: true
        };

        let autoBreadcrumbs = globalOptions.autoBreadcrumbs;
        if ({}.toString.call(autoBreadcrumbs) === '[object Object]') {
            autoBreadcrumbs = objectMerge(autoBreadcrumbDefaults, autoBreadcrumbs);
        } else if (autoBreadcrumbs !== false) {
            autoBreadcrumbs = autoBreadcrumbDefaults;
        }
        globalOptions.autoBreadcrumbs = autoBreadcrumbs;

        let instrumentDefaults = {
            tryCatch: true
        };

        let instrument = globalOptions.instrument;
        if ({}.toString.call(instrument) === '[object Object]') {
            instrument = objectMerge(instrumentDefaults, instrument);
        } else if (instrument !== false) {
            instrument = instrumentDefaults;
        }
        globalOptions.instrument = instrument;

        TraceKit.collectWindowErrors = !!globalOptions.collectWindowErrors;

        // return for chaining
        return self;
    },

    /*
     * Installs a global window.onerror error handler
     * to capture and report uncaught exceptions.
     * At this point, install() is required to be called due
     * to the way TraceKit is set up.
     *
     * @return {Hermes}
     */
    install() {
        let self = this;
        const environmentEnable = self._globalOptions.enable === 'pass' ? !self.debug : self._globalOptions.enable;
        if (environmentEnable && self.isSetup() && !self._isHermesInstalled) {
            TraceKit.report.subscribe(function() {
                self._handleOnErrorStackInfo(...arguments);
            });

            if (self._globalOptions.captureUnhandledRejections) {
                self._attachPromiseRejectionHandler();
            }

            self._patchFunctionToString();

            if (self._globalOptions.instrument && self._globalOptions.instrument.tryCatch) {
                self._instrumentTryCatch();
            }

            if (self._globalOptions.autoBreadcrumbs) {
                self._instrumentBreadcrumbs();
            }

            if (self._globalOptions.pv) {
                self._instrumentPv();
            }

            if (self._globalOptions.monitorJank) {
                self._jankMonitor = new JankMonitor({
                    name: 'Tester',
                    slowStandard: 400,
                    eventTimeout: 2500,
                    onSlowFunc(data) {
                        console.log(data);
                    }
                });
            }

            if (self._globalOptions.performanceTiming) {
                let timing = require('../vendor/performance/timing');
                // console.log(timing);
            }

            // Install all of the plugins
            self._drainPlugins();

            self._isHermesInstalled = true;
        }

        Error.stackTraceLimit = self._globalOptions.stackTraceLimit;
        return this;
    },

    /*
     * Set the Username (can be called multiple time unlike config)
     *
     * @param {string} username
     */
    setUsername(username) {
        const self = this;

        self._raw_username = username;
        self._username = aes(username || 'anonymous');
        // self._globalServer = self._getGlobalServer(uri);

        self._globalErrorEndpoint = `${self._globalServer}/api/stat/error/report`;
        self._globalViewEndpoint = `${self._globalServer}/hermuz`;

        // Reset backoff state since we may be pointing at a
        // new project/server
        this._resetBackoff();
    },

    /*
     * Wrap code within a context so Hermes can capture errors
     * reliably across domains that is executed immediately.
     *
     * @param {object} options A specific set of options for this context [optional]
     * @param {function} func The callback to be immediately executed within the context
     * @param {array} args An array of arguments to be called with the callback [optional]
     */
    context(options, func, args) {
        if (isFunction(options)) {
            args = func || [];
            func = options;
            options = undefined;
        }

        return this.wrap(options, func).apply(this, args);
    },

    /*
     * Wrap code within a context and returns back a new function to be executed
     *
     * @param {object} options A specific set of options for this context [optional]
     * @param {function} func The function to be wrapped in a new context
     * @param {function} func A function to call before the try/catch wrapper [optional, private]
     * @return {function} The newly wrapped functions with a context
     */
    wrap(options, func, _before) {
        let self = this;
        // 1 argument has been passed, and it's not a function
        // so just return it
        if (isUndefined(func) && !isFunction(options)) {
            return options;
        }

        // options is optional
        if (isFunction(options)) {
            func = options;
            options = undefined;
        }

        // At this point, we've passed along 2 arguments, and the second one
        // is not a function either, so we'll just return the second argument.
        if (!isFunction(func)) {
            return func;
        }

        // We don't wanna wrap it twice!
        try {
            if (func.__hermes__) {
                return func;
            }

            // If this has already been wrapped in the past, return that
            if (func.__hermes_wrapper__) {
                return func.__hermes_wrapper__;
            }
        } catch (e) {
            // Just accessing custom props in some Selenium environments
            // can cause a "Permission denied" exception (see raven-js#495).
            // Bail on wrapping and return the function as-is (defers to window.onerror).
            return func;
        }

        function wrapped() {
            let args = [],
                i = arguments.length,
                deep = !options || (options && options.deep !== false);

            if (_before && isFunction(_before)) {
                _before.apply(this, arguments);
            }

            // Recursively wrap all of a function's arguments that are
            // functions themselves.
            while (i--) {
                args[i] = deep ? self.wrap(options, arguments[i]) : arguments[i];
            }

            try {
                // Attempt to invoke user-land function
                // NOTE: If you are a Sentry user, and you are seeing this stack frame, it
                //       means Raven caught an error invoking your application code. This is
                //       expected behavior and NOT indicative of a bug with Raven.js.
                return func.apply(this, args);
            } catch (e) {
                self._ignoreNextOnError();
                self.captureException(e, options);
                throw e;
            }
        }

        // copy over properties of the old function
        for (let property in func) {
            if (hasKey(func, property)) {
                wrapped[property] = func[property];
            }
        }
        wrapped.prototype = func.prototype;

        func.__hermes_wrapper__ = wrapped;
        // Signal that this function has been wrapped/filled already
        // for both debugging and to prevent it to being wrapped/filled twice
        wrapped.__hermes__ = true;
        wrapped.__orig__ = func;

        return wrapped;
    },

    /**
     * Uninstalls the global error handler.
     *
     * @return {Hermes}
     */
    uninstall() {
        TraceKit.report.uninstall();

        this._detachPromiseRejectionHandler();
        this._unpatchFunctionToString();
        this._restoreBuiltIns();
        this._restoreConsole();

        Error.stackTraceLimit = this._originalErrorStackTraceLimit;
        this._isHermesInstalled = false;

        return this;
    },

    /**
     * Callback used for `unhandledrejection` event
     *
     * @param {PromiseRejectionEvent} event An object containing
     *   promise: the Promise that was rejected
     *   reason: the value with which the Promise was rejected
     * @return void
     */
    _promiseRejectionHandler(event) {
        this._logDebug('debug', 'Hermes caught unhandled promise rejection:', event);
        this.captureException(event.reason, {
            extra: {
                unhandledPromiseRejection: true
            }
        });
    },

    /**
     * Installs the global promise rejection handler.
     *
     * @return {Hermes}
     */
    _attachPromiseRejectionHandler() {
        this._promiseRejectionHandler = this._promiseRejectionHandler.bind(this);
        _window.addEventListener && _window.addEventListener('unhandledrejection', this._promiseRejectionHandler);
        return this;
    },

    /**
     * Uninstalls the global promise rejection handler.
     *
     * @return {Hermes}
     */
    _detachPromiseRejectionHandler() {
        _window.removeEventListener && _window.removeEventListener('unhandledrejection', this._promiseRejectionHandler);
        return this;
    },

    /**
     * Manually capture an exception and send it
     *
     * @param {error} ex An exception to be logged
     * @param {object} options A specific set of options for this error [optional]
     * @return {Hermes}
     */
    captureException(ex, options) {
        options = objectMerge({ trimHeadFrames: 0 }, options ? options : {});

        if (isErrorEvent(ex) && ex.error) {
            // If it is an ErrorEvent with `error` property, extract it to get actual Error
            ex = ex.error;
        } else if (isDOMError(ex) || isDOMException(ex)) {
            // If it is a DOMError or DOMException (which are legacy APIs, but still supported in some browsers)
            // then we just extract the name and message, as they don't provide anything else
            // https://developer.mozilla.org/en-US/docs/Web/API/DOMError
            // https://developer.mozilla.org/en-US/docs/Web/API/DOMException
            let name = ex.name || (isDOMError(ex) ? 'DOMError' : 'DOMException');
            let message = ex.message ? `${name}: ${ex.message}` : name;

            return this.captureMessage(
                message,
                objectMerge(options, {
                    // neither DOMError or DOMException provide stack trace and we most likely wont get it this way as well
                    // but it's barely any overhead so we may at least try
                    stacktrace: true,
                    trimHeadFrames: options.trimHeadFrames + 1
                })
            );
        } else if (isError(ex)) {
            // we have a real Error object
            ex = ex;
        } else if (isPlainObject(ex)) {
            // If it is plain Object, serialize it manually and extract options
            // This will allow us to group events based on top-level keys
            // which is much better than creating new group when any key/value change
            options = this._getCaptureExceptionOptionsFromPlainObject(options, ex);
            ex = new Error(options.message);
        } else {
            // If none of previous checks were valid, then it means that
            // it's not a DOMError/DOMException
            // it's not a plain Object
            // it's not a valid ErrorEvent (one with an error property)
            // it's not an Error
            // So bail out and capture it as a simple message:
            return this.captureMessage(
                ex,
                objectMerge(options, {
                    stacktrace: true, // if we fall back to captureMessage, default to attempting a new trace
                    trimHeadFrames: options.trimHeadFrames + 1
                })
            );
        }

        // Store the raw exception object for potential debugging and introspection
        this._lastCapturedException = ex;

        // TraceKit.report will re-raise any exception passed to it,
        // which means you have to wrap it in try/catch. Instead, we
        // can wrap it here and only re-raise if TraceKit.report
        // raises an exception different from the one we asked to
        // report on.
        try {
            let stack = TraceKit.computeStackTrace(ex);
            this._handleStackInfo(stack, options);
        } catch (ex1) {
            if (ex !== ex1) {
                throw ex1;
            }
        }

        return this;
    },

    _getCaptureExceptionOptionsFromPlainObject(currentOptions, ex) {
        let exKeys = Object.keys(ex).sort();
        let options = objectMerge(currentOptions, {
            message: `Non-Error exception captured with keys: ${serializeKeysForMessage(exKeys)}`,
            fingerprint: [md5(exKeys)],
            extra: currentOptions.extra || {}
        });
        options.extra.__serialized__ = serializeException(ex);

        return options;
    },

    /*
     * Manually send a message
     *
     * @param {string} msg A plain message to be captured
     * @param {object} options A specific set of options for this message [optional]
     * @return {Hermes}
     */
    captureMessage(msg, options) {
        // config() automagically converts ignoreErrors from a list to a RegExp so we need to test for an
        // early call; we'll error on the side of logging anything called before configuration since it's
        // probably something you should see:
        if (!!this._globalOptions.ignoreErrors.test && this._globalOptions.ignoreErrors.test(msg)) {
            return;
        }

        options = options || {};
        msg = `${msg}`; // Make sure it's actually a string

        let data = objectMerge(
            {
                message: msg
            },
            options
        );

        let ex;
        // Generate a "synthetic" stack trace from this point.
        // NOTE: If you are a Sentry user, and you are seeing this stack frame, it is NOT indicative
        //       of a bug with Raven.js. Sentry generates synthetic traces either by configuration,
        //       or if it catches a thrown object without a "stack" property.
        try {
            throw new Error(msg);
        } catch (ex1) {
            ex = ex1;
        }

        // null exception name so `Error` isn't prefixed to msg
        ex.name = null;
        let stack = TraceKit.computeStackTrace(ex);

        // stack[0] is `throw new Error(msg)` call itself, we are interested in the frame that was just before that, stack[1]
        let initialCall = isArray(stack.stack) && stack.stack[1];

        // if stack[1] is `Hermes.captureException`, it means that someone passed a string to it and we redirected that call
        // to be handled by `captureMessage`, thus `initialCall` is the 3rd one, not 2nd
        // initialCall => captureException(string) => captureMessage(string)
        if (initialCall && initialCall.func === 'Hermes.captureException') {
            initialCall = stack.stack[2];
        }

        let fileurl = (initialCall && initialCall.url) || '';

        if (!!this._globalOptions.ignoreUrls.test && this._globalOptions.ignoreUrls.test(fileurl)) {
            return;
        }

        if (!!this._globalOptions.whitelistUrls.test && !this._globalOptions.whitelistUrls.test(fileurl)) {
            return;
        }

        if (this._globalOptions.stacktrace || (options && options.stacktrace)) {
            // fingerprint on msg, not stack trace (legacy behavior, could be revisited)
            data.fingerprint = data.fingerprint == null ? msg : data.fingerprint;

            options = objectMerge(
                {
                    trimHeadFrames: 0
                },
                options
            );
            // Since we know this is a synthetic trace, the top frame (this function call)
            // MUST be from Raven.js, so mark it for trimming
            // We add to the trim counter so that callers can choose to trim extra frames, such
            // as utility functions.
            options.trimHeadFrames += 1;

            let frames = this._prepareFrames(stack, options);
            data.stacktrace = {
                // Sentry expects frames oldest to newest
                frames: frames.reverse()
            };
        }

        // Make sure that fingerprint is always wrapped in an array
        if (data.fingerprint) {
            data.fingerprint = isArray(data.fingerprint) ? data.fingerprint : [data.fingerprint];
        }

        // Fire away!
        this._send(data);

        return this;
    },

    captureBreadcrumb(obj) {
        let crumb = objectMerge(
            {
                timestamp: now() / 1000
            },
            obj
        );

        if (isFunction(this._globalOptions.breadcrumbCallback)) {
            let result = this._globalOptions.breadcrumbCallback(crumb);

            if (isObject(result) && !isEmptyObject(result)) {
                crumb = result;
            } else if (result === false) {
                return this;
            }
        }

        this._breadcrumbs.push(crumb);
        if (this._breadcrumbs.length > this._globalOptions.maxBreadcrumbs) {
            this._breadcrumbs.shift();
        }
        return this;
    },

    reportUrlView(obj) {
        const request = new XMLHttpRequest();
        request.open('GET', `${this._globalViewEndpoint}?data=${btoa(JSON.stringify(obj))}`);
        request.headers = Object.assign({}, request.headers, {
            'X-Requested-User': this._username
        });
        request.send(null);
        return this;
    },

    addPlugin(plugin /*arg1, arg2, ... argN*/) {
        let pluginArgs = [].slice.call(arguments, 1);

        this._plugins.push([plugin, pluginArgs]);
        if (this._isHermesInstalled) {
            this._drainPlugins();
        }

        return this;
    },

    /*
     * Set/clear a user to be sent along with the payload.
     *
     * @param {object} user An object representing user data [optional]
     * @return {Hermes}
     */
    setUserContext(user) {
        // Intentionally do not merge here since that's an unexpected behavior.
        this._globalContext.user = user;

        return this;
    },

    /*
     * Merge extra attributes to be sent along with the payload.
     *
     * @param {object} extra An object representing extra data [optional]
     * @return {Hermes}
     */
    setExtraContext(extra) {
        this._mergeContext('extra', extra);

        return this;
    },

    /*
     * Merge tags to be sent along with the payload.
     *
     * @param {object} tags An object representing tags [optional]
     * @return {Hermes}
     */
    setTagsContext(tags) {
        this._mergeContext('tags', tags);

        return this;
    },

    /*
     * Clear all of the context.
     *
     * @return {Hermes}
     */
    clearContext() {
        this._globalContext = {};

        return this;
    },

    /*
     * Get a copy of the current context. This cannot be mutated.
     *
     * @return {object} copy of context
     */
    getContext() {
        // lol javascript
        return JSON.parse(stringify(this._globalContext));
    },

    /*
     * Set environment of application
     *
     * @param {string} environment Typically something like 'production'.
     * @return {Hermes}
     */
    setEnvironment(environment) {
        this._globalOptions.environment = environment;

        return this;
    },

    /*
     * Set the dataCallback option
     *
     * @param {function} callback The callback to run which allows the
     *                            data blob to be mutated before sending
     * @return {Hermes}
     */
    setDataCallback(callback) {
        let original = this._globalOptions.dataCallback;
        this._globalOptions.dataCallback = keepOriginalCallback(original, callback);
        return this;
    },

    /*
     * Set the breadcrumbCallback option
     *
     * @param {function} callback The callback to run which allows filtering
     *                            or mutating breadcrumbs
     * @return {Hermes}
     */
    setBreadcrumbCallback(callback) {
        let original = this._globalOptions.breadcrumbCallback;
        this._globalOptions.breadcrumbCallback = keepOriginalCallback(original, callback);
        return this;
    },

    /*
     * Set the shouldSendCallback option
     *
     * @param {function} callback The callback to run which allows
     *                            introspecting the blob before sending
     * @return {Hermes}
     */
    setShouldSendCallback(callback) {
        let original = this._globalOptions.shouldSendCallback;
        this._globalOptions.shouldSendCallback = keepOriginalCallback(original, callback);
        return this;
    },

    /**
     * Override the default HTTP transport mechanism that transmits data
     * to the Sentry server.
     *
     * @param {function} transport Function invoked instead of the default
     *                             `makeRequest` handler.
     *
     * @return {Hermes}
     */
    setTransport(transport) {
        this._globalOptions.transport = transport;

        return this;
    },

    /*
     * Get the latest raw exception that was captured by Hermes.
     *
     * @return {error}
     */
    lastException() {
        return this._lastCapturedException;
    },

    /*
     * Get the last event id
     *
     * @return {string}
     */
    lastEventId() {
        return this._lastEventId;
    },

    /*
     * Determine if Hermes is setup and ready to go.
     *
     * @return {boolean}
     */
    isSetup() {
        if (!this._hasJSON) {
            return false;
        } // needs JSON support
        if (!this._globalServer) {
            if (!this.hermesNotConfiguredError) {
                this.hermesNotConfiguredError = true;
                this._logDebug('error', 'Error: Hermes has not been configured.');
            }
            return false;
        }
        return true;
    },

    afterLoad() {
        // TODO: remove window dependence?

        // Attempt to initialize Hermes on load
        let HermesConfig = _window.HermesConfig;
        if (HermesConfig) {
            this.config(HermesConfig.username, HermesConfig.config).install();
        }
    },

    /**** Private functions ****/
    _ignoreNextOnError() {
        let self = this;
        this._ignoreOnError += 1;
        setTimeout(() => {
            // onerror should trigger before setTimeout
            self._ignoreOnError -= 1;
        });
    },

    _triggerEvent(eventType, options) {
        // NOTE: `event` is a native browser thing, so let's avoid conflicting wiht it
        let evt, key;

        if (!this._hasDocument) {
            return;
        }

        options = options || {};

        eventType = `hermes${eventType.substr(0, 1).toUpperCase()}${eventType.substr(1)}`;

        if (_document.createEvent) {
            evt = _document.createEvent('HTMLEvents');
            evt.initEvent(eventType, true, true);
        } else {
            evt = _document.createEventObject();
            evt.eventType = eventType;
        }

        for (key in options) {
            if (hasKey(options, key)) {
                evt[key] = options[key];
            }
        }

        if (_document.createEvent) {
            // IE9 if standards
            _document.dispatchEvent(evt);
        } else {
            // IE8 regardless of Quirks or Standards
            // IE9 if quirks
            try {
                _document.fireEvent(`on${evt.eventType.toLowerCase()}`, evt);
            } catch (e) {
                // Do nothing
            }
        }
    },

    /**
     * Wraps addEventListener to capture UI breadcrumbs
     * @param evtName the event name (e.g. "click")
     * @returns {Function}
     * @private
     */
    _breadcrumbEventHandler(evtName) {
        let self = this;
        return function(evt) {
            // reset keypress timeout; e.g. triggering a 'click' after
            // a 'keypress' will reset the keypress debounce so that a new
            // set of keypresses can be recorded
            self._keypressTimeout = null;

            // It's possible this handler might trigger multiple times for the same
            // event (e.g. event propagation through node ancestors). Ignore if we've
            // already captured the event.
            if (self._lastCapturedEvent === evt) {
                return;
            }

            self._lastCapturedEvent = evt;

            // try/catch both:
            // - accessing evt.target (see getsentry/raven-js#838, #768)
            // - `htmlTreeAsString` because it's complex, and just accessing the DOM incorrectly
            //   can throw an exception in some circumstances.
            let target;
            try {
                target = htmlTreeAsString(evt.target);
            } catch (e) {
                target = '<unknown>';
            }

            self.captureBreadcrumb({
                category: `ui.${evtName}`, // e.g. ui.click, ui.input
                message: target
            });
        };
    },

    /**
     * Wraps addEventListener to capture keypress UI events
     * @returns {Function}
     * @private
     */
    _keypressEventHandler() {
        let self = this,
            debounceDuration = 1000; // milliseconds

        // TODO: if somehow user switches keypress target before
        //       debounce timeout is triggered, we will only capture
        //       a single breadcrumb from the FIRST target (acceptable?)
        return function(evt) {
            let target;
            try {
                target = evt.target;
            } catch (e) {
                // just accessing event properties can throw an exception in some rare circumstances
                // see: https://github.com/getsentry/raven-js/issues/838
                return;
            }
            let tagName = target && target.tagName;

            // only consider keypress events on actual input elements
            // this will disregard keypresses targeting body (e.g. tabbing
            // through elements, hotkeys, etc)
            if (!tagName || (tagName !== 'INPUT' && tagName !== 'TEXTAREA' && !target.isContentEditable)) {
                return;
            }

            // record first keypress in a series, but ignore subsequent
            // keypresses until debounce clears
            let timeout = self._keypressTimeout;
            if (!timeout) {
                self._breadcrumbEventHandler('input')(evt);
            }
            clearTimeout(timeout);
            self._keypressTimeout = setTimeout(() => {
                self._keypressTimeout = null;
            }, debounceDuration);
        };
    },

    /**
     * Captures a breadcrumb of type "navigation", normalizing input URLs
     * @param to the originating URL
     * @param from the target URL
     * @private
     */
    _captureUrlChange(from, to) {
        let parsedLoc = parseUrl(this._location.href);
        let parsedTo = parseUrl(to);
        let parsedFrom = parseUrl(from);

        // because onpopstate only tells you the "new" (to) value of location.href, and
        // not the previous (from) value, we need to track the value of the current URL
        // state ourselves
        this._lastHref = to;

        // Use only the path component of the URL if the URL matches the current
        // document (almost all the time when using pushState)
        if (parsedLoc.protocol === parsedTo.protocol && parsedLoc.host === parsedTo.host) {
            to = parsedTo.relative;
        }
        if (parsedLoc.protocol === parsedFrom.protocol && parsedLoc.host === parsedFrom.host) {
            from = parsedFrom.relative;
        }

        this.captureBreadcrumb({
            category: 'navigation',
            data: {
                to,
                from
            }
        });
    },

    _patchFunctionToString() {
        let self = this;
        self._originalFunctionToString = Function.prototype.toString;
        // eslint-disable-next-line no-extend-native
        Function.prototype.toString = function() {
            if (typeof this === 'function' && this.__hermes__) {
                return self._originalFunctionToString.apply(this.__orig__, arguments);
            }
            return self._originalFunctionToString.apply(this, arguments);
        };
    },

    _unpatchFunctionToString() {
        if (this._originalFunctionToString) {
            // eslint-disable-next-line no-extend-native
            Function.prototype.toString = this._originalFunctionToString;
        }
    },

    /**
     * Wrap timer functions and event targets to catch errors and provide
     * better metadata.
     */
    _instrumentTryCatch() {
        let self = this;

        let wrappedBuiltIns = self._wrappedBuiltIns;

        function wrapTimeFn(orig) {
            return function(fn, t) {
                // preserve arity
                // Make a copy of the arguments to prevent deoptimization
                // https://github.com/petkaantonov/bluebird/wiki/Optimization-killers#32-leaking-arguments
                let args = new Array(arguments.length);
                for (let i = 0; i < args.length; ++i) {
                    args[i] = arguments[i];
                }
                let originalCallback = args[0];
                if (isFunction(originalCallback)) {
                    args[0] = self.wrap(originalCallback);
                }

                // IE < 9 doesn't support .call/.apply on setInterval/setTimeout, but it
                // also supports only two arguments and doesn't care what this is, so we
                // can just call the original function directly.
                if (orig.apply) {
                    return orig.apply(this, args);
                }
                return orig(args[0], args[1]);
            };
        }

        let autoBreadcrumbs = this._globalOptions.autoBreadcrumbs;

        function wrapEventTarget(global) {
            let proto = _window[global] && _window[global].prototype;
            if (proto && proto.hasOwnProperty && proto.hasOwnProperty('addEventListener')) {
                fill(
                    proto,
                    'addEventListener',
                    orig =>
                        function(evtName, fn, capture, secure) {
                            // preserve arity
                            try {
                                if (fn && fn.handleEvent) {
                                    fn.handleEvent = self.wrap(fn.handleEvent);
                                }
                            } catch (err) {
                                // can sometimes get 'Permission denied to access property "handle Event'
                            }

                            // More breadcrumb DOM capture ... done here and not in `_instrumentBreadcrumbs`
                            // so that we don't have more than one wrapper function
                            let before, clickHandler, keypressHandler;

                            if (autoBreadcrumbs && autoBreadcrumbs.dom && (global === 'EventTarget' || global === 'Node')) {
                                // NOTE: generating multiple handlers per addEventListener invocation, should
                                //       revisit and verify we can just use one (almost certainly)
                                clickHandler = self._breadcrumbEventHandler('click');
                                keypressHandler = self._keypressEventHandler();
                                before = function(evt) {
                                    // need to intercept every DOM event in `before` argument, in case that
                                    // same wrapped method is re-used for different events (e.g. mousemove THEN click)
                                    // see #724
                                    if (!evt) {
                                        return;
                                    }

                                    let eventType;
                                    try {
                                        eventType = evt.type;
                                    } catch (e) {
                                        // just accessing event properties can throw an exception in some rare circumstances
                                        // see: https://github.com/getsentry/raven-js/issues/838
                                        return;
                                    }
                                    if (eventType === 'click') {
                                        return clickHandler(evt);
                                    } else if (eventType === 'keypress') {
                                        return keypressHandler(evt);
                                    }
                                };
                            }
                            return orig.call(this, evtName, self.wrap(fn, undefined, before), capture, secure);
                        },
                    wrappedBuiltIns
                );
                fill(
                    proto,
                    'removeEventListener',
                    orig =>
                        function(evt, fn, capture, secure) {
                            try {
                                fn = fn && (fn.__hermes_wrapper__ ? fn.__hermes_wrapper__ : fn);
                            } catch (e) {
                                // ignore, accessing __hermes_wrapper__ will throw in some Selenium environments
                            }
                            return orig.call(this, evt, fn, capture, secure);
                        },
                    wrappedBuiltIns
                );
            }
        }

        fill(_window, 'setTimeout', wrapTimeFn, wrappedBuiltIns);
        fill(_window, 'setInterval', wrapTimeFn, wrappedBuiltIns);
        if (_window.requestAnimationFrame) {
            fill(
                _window,
                'requestAnimationFrame',
                orig =>
                    function(cb) {
                        return orig(self.wrap(cb));
                    },
                wrappedBuiltIns
            );
        }

        // event targets borrowed from bugsnag-js:
        // https://github.com/bugsnag/bugsnag-js/blob/master/src/bugsnag.js#L666
        let eventTargets = [
            'EventTarget',
            'Window',
            'Node',
            'ApplicationCache',
            'AudioTrackList',
            'ChannelMergerNode',
            'CryptoOperation',
            'EventSource',
            'FileReader',
            'HTMLUnknownElement',
            'IDBDatabase',
            'IDBRequest',
            'IDBTransaction',
            'KeyOperation',
            'MediaController',
            'MessagePort',
            'ModalWindow',
            'Notification',
            'SVGElementInstance',
            'Screen',
            'TextTrack',
            'TextTrackCue',
            'TextTrackList',
            'WebSocket',
            'WebSocketWorker',
            'Worker',
            'XMLHttpRequest',
            'XMLHttpRequestEventTarget',
            'XMLHttpRequestUpload'
        ];
        for (let i = 0; i < eventTargets.length; i++) {
            wrapEventTarget(eventTargets[i]);
        }
    },

    /**
     * Instrument browser built-ins w/ breadcrumb capturing
     *  - XMLHttpRequests
     *  - DOM interactions (click/typing)
     *  - window.location changes
     *  - console
     *
     * Can be disabled or individually configured via the `autoBreadcrumbs` config option
     */
    _instrumentBreadcrumbs() {
        let self = this;
        let autoBreadcrumbs = this._globalOptions.autoBreadcrumbs;

        let wrappedBuiltIns = self._wrappedBuiltIns;

        function wrapProp(prop, xhr) {
            if (prop in xhr && isFunction(xhr[prop])) {
                fill(xhr, prop, orig => self.wrap(orig)); // intentionally don't track filled methods on XHR instances
            }
        }

        if (autoBreadcrumbs.xhr && 'XMLHttpRequest' in _window) {
            let xhrproto = _window.XMLHttpRequest && _window.XMLHttpRequest.prototype;
            fill(
                xhrproto,
                'open',
                origOpen =>
                    function(method, url) {
                        // preserve arity
                        let xhr = this;

                        origOpen.apply(this, arguments);
                        if (url.indexOf(_window.location.host) !== -1) {
                            xhr.setRequestHeader('X-Requested-User', self._username);
                        }

                        return;
                    },
                wrappedBuiltIns
            );

            fill(
                xhrproto,
                'send',
                origSend =>
                    function() {
                        // preserve arity
                        let xhr = this;

                        function onreadystatechangeHandler() {
                            if (xhr.__hermes_xhr && xhr.readyState === 4) {
                                try {
                                    // touching statusCode in some platforms throws
                                    // an exception
                                    xhr.__hermes_xhr.status_code = xhr.status;
                                } catch (e) {
                                    /* do nothing */
                                }

                                self.captureBreadcrumb({
                                    type: 'http',
                                    category: 'xhr',
                                    data: xhr.__hermes_xhr
                                });
                            }
                        }

                        let props = ['onload', 'onerror', 'onprogress'];
                        for (let j = 0; j < props.length; j++) {
                            wrapProp(props[j], xhr);
                        }

                        if ('onreadystatechange' in xhr && isFunction(xhr.onreadystatechange)) {
                            fill(
                                xhr,
                                'onreadystatechange',
                                orig => self.wrap(orig, undefined, onreadystatechangeHandler) /* intentionally don't track this instrumentation */
                            );
                        } else {
                            // if onreadystatechange wasn't actually set by the page on this xhr, we
                            // are free to set our own and capture the breadcrumb
                            xhr.onreadystatechange = onreadystatechangeHandler;
                        }

                        return origSend.apply(this, arguments);
                    },
                wrappedBuiltIns
            );
        }

        if (autoBreadcrumbs.xhr && supportsFetch()) {
            fill(
                _window,
                'fetch',
                origFetch =>
                    function() {
                        // preserve arity
                        // Make a copy of the arguments to prevent deoptimization
                        // https://github.com/petkaantonov/bluebird/wiki/Optimization-killers#32-leaking-arguments
                        let args = new Array(arguments.length);
                        for (let i = 0; i < args.length; ++i) {
                            args[i] = arguments[i];
                        }

                        let fetchInput = args[0];
                        let method = 'GET';
                        let url;

                        if (typeof fetchInput === 'string') {
                            url = fetchInput;
                        } else if ('Request' in _window && fetchInput instanceof _window.Request) {
                            url = fetchInput.url;
                            if (fetchInput.method) {
                                method = fetchInput.method;
                            }
                        } else {
                            url = `${fetchInput}`;
                        }

                        if (args[1] && args[1].method) {
                            method = args[1].method;
                        }

                        if (args[1] && url.indexOf(_window.location.host) !== -1) {
                            args[1].headers = Object.assign({}, args[1].headers, {
                                'X-Requested-User': self._username
                            });
                        }

                        let fetchData = {
                            method,
                            url,
                            status_code: null
                        };

                        return origFetch
                            .apply(this, args)
                            .then((response) => {
                                fetchData.status_code = response.status;

                                self.captureBreadcrumb({
                                    type: 'http',
                                    category: 'fetch',
                                    data: fetchData
                                });

                                return response;
                            })
                            .catch((err) => {
                                // if there is an error performing the request
                                self.captureBreadcrumb({
                                    type: 'http',
                                    category: 'fetch',
                                    data: fetchData,
                                    level: 'error'
                                });

                                throw err;
                            });
                    },
                wrappedBuiltIns
            );
        }

        // Capture breadcrumbs from any click that is unhandled / bubbled up all the way
        // to the document. Do this before we instrument addEventListener.
        if (autoBreadcrumbs.dom && this._hasDocument) {
            if (_document.addEventListener) {
                _document.addEventListener('click', self._breadcrumbEventHandler('click'), false);
                _document.addEventListener('keypress', self._keypressEventHandler(), false);
            } else if (_document.attachEvent) {
                // IE8 Compatibility
                _document.attachEvent('onclick', self._breadcrumbEventHandler('click'));
                _document.attachEvent('onkeypress', self._keypressEventHandler());
            }
        }

        // record navigation (URL) changes
        // NOTE: in Chrome App environment, touching history.pushState, *even inside
        //       a try/catch block*, will cause Chrome to output an error to console.error
        // borrowed from: https://github.com/angular/angular.js/pull/13945/files
        let chrome = _window.chrome;
        let isChromePackagedApp = chrome && chrome.app && chrome.app.runtime;
        let hasPushAndReplaceState = !isChromePackagedApp && _window.history && history.pushState && history.replaceState;
        if (autoBreadcrumbs.location && hasPushAndReplaceState) {
            // TODO: remove onpopstate handler on uninstall()
            let oldOnPopState = _window.onpopstate;
            _window.onpopstate = function() {
                let currentHref = self._location.href;
                self._captureUrlChange(self._lastHref, currentHref);

                if (oldOnPopState) {
                    return oldOnPopState.apply(this, arguments);
                }
            };

            let historyReplacementFunction = function(origHistFunction) {
                // note history.pushState.length is 0; intentionally not declaring
                // params to preserve 0 arity
                return function(/* state, title, url */) {
                    let url = arguments.length > 2 ? arguments[2] : undefined;

                    // url argument is optional
                    if (url) {
                        // coerce to string (this is what pushState does)
                        self._captureUrlChange(self._lastHref, `${url}`);
                    }

                    return origHistFunction.apply(this, arguments);
                };
            };

            fill(history, 'pushState', historyReplacementFunction, wrappedBuiltIns);
            fill(history, 'replaceState', historyReplacementFunction, wrappedBuiltIns);
        }

        if (autoBreadcrumbs.console && 'console' in _window && console.log) {
            // console
            let consoleMethodCallback = function(msg, data) {
                self.captureBreadcrumb({
                    message: msg,
                    level: data.level,
                    category: 'console'
                });
            };

            each(['debug', 'info', 'warn', 'error', 'log'], (_, level) => {
                wrapConsoleMethod(console, level, consoleMethodCallback);
            });
        }
    },

    _instrumentPv() {
        pageView(_window, this.reportUrlView.bind(this));
    },

    _restoreBuiltIns() {
        // restore any wrapped builtins
        let builtin;
        while (this._wrappedBuiltIns.length) {
            builtin = this._wrappedBuiltIns.shift();

            let obj = builtin[0],
                name = builtin[1],
                orig = builtin[2];

            obj[name] = orig;
        }
    },

    _restoreConsole() {
        // eslint-disable-next-line guard-for-in
        for (let method in this._originalConsoleMethods) {
            this._originalConsole[method] = this._originalConsoleMethods[method];
        }
    },

    _drainPlugins() {
        let self = this;

        // FIX ME TODO
        each(this._plugins, (_, plugin) => {
            let installer = plugin[0];
            let args = plugin[1];
            installer.apply(self, [self].concat(args));
        });
    },
    /*
    _parseDSN(str) {
        let m = dsnPattern.exec(str),
            dsn = {},
            i = 7;

        try {
            while (i--) {
                dsn[dsnKeys[i]] = m[i] || '';
            }
        } catch (e) {
            throw new HermesConfigError(`Invalid DSN: ${str}`);
        }

        if (dsn.pass && !this._globalOptions.allowSecretKey) {
            throw new HermesConfigError('Do not specify your secret key in the DSN. ');
        }

        return dsn;
    },
    */

    _getGlobalServer(uri) {
        // assemble the endpoint from the uri pieces
        let globalServer = `//${uri.host}${uri.port ? `:${uri.port}` : ''}`;

        if (uri.protocol) {
            globalServer = `${uri.protocol}:${globalServer}`;
        }
        return globalServer;
    },

    _handleOnErrorStackInfo() {
        // if we are intentionally ignoring errors via onerror, bail out
        if (!this._ignoreOnError) {
            this._handleStackInfo.apply(this, arguments);
        }
    },

    _handleStackInfo(stackInfo, options) {
        let frames = this._prepareFrames(stackInfo, options);

        this._triggerEvent('handle', {
            stackInfo,
            options
        });

        this._processException(stackInfo.name, stackInfo.message, stackInfo.url, stackInfo.lineno, frames, options);
    },

    _prepareFrames(stackInfo, options) {
        let self = this;
        let frames = [];
        if (stackInfo.stack && stackInfo.stack.length) {
            each(stackInfo.stack, (i, stack) => {
                let frame = self._normalizeFrame(stack, stackInfo.url);
                if (frame) {
                    frames.push(frame);
                }
            });

            // e.g. frames captured via captureMessage throw
            if (options && options.trimHeadFrames) {
                for (let j = 0; j < options.trimHeadFrames && j < frames.length; j++) {
                    frames[j].in_app = false;
                }
            }
        }
        frames = frames.slice(0, this._globalOptions.stackTraceLimit);
        return frames;
    },

    _normalizeFrame(frame, stackInfoUrl) {
        // normalize the frames data
        let normalized = {
            filename: frame.url,
            lineno: frame.line,
            colno: frame.column,
            function: frame.func || '?'
        };

        // Case when we don't have any information about the error
        // E.g. throwing a string or raw object, instead of an `Error` in Firefox
        // Generating synthetic error doesn't add any value here
        //
        // We should probably somehow let a user know that they should fix their code
        if (!frame.url) {
            normalized.filename = stackInfoUrl; // fallback to whole stacks url from onerror handler
        }

        normalized.in_app = !// determine if an exception came from outside of our app
        // first we check the global includePaths list.
        (
            (!!this._globalOptions.includePaths.test && !this._globalOptions.includePaths.test(normalized.filename)) ||
            // Now we check for fun, if the function name is Hermes or TraceKit
            /(Hermes|TraceKit)\./.test(normalized.function) ||
            // finally, we do a last ditch effort and check for hermes.min.js
            /hermes\.(min\.)?js$/.test(normalized.filename)
        );

        return normalized;
    },

    _processException(type, message, fileurl, lineno, frames, options) {
        let prefixedMessage = (type ? `${type}: ` : '') + (message || '');
        if (
            !!this._globalOptions.ignoreErrors.test &&
            (this._globalOptions.ignoreErrors.test(message) || this._globalOptions.ignoreErrors.test(prefixedMessage))
        ) {
            return;
        }

        let stacktrace;

        if (frames && frames.length) {
            fileurl = frames[0].filename || fileurl;
            // Sentry expects frames oldest to newest
            // and JS sends them as newest to oldest
            frames.reverse();
            stacktrace = { frames };
        } else if (fileurl) {
            stacktrace = {
                frames: [
                    {
                        filename: fileurl,
                        lineno,
                        in_app: true
                    }
                ]
            };
        }

        if (!!this._globalOptions.ignoreUrls.test && this._globalOptions.ignoreUrls.test(fileurl)) {
            return;
        }

        if (!!this._globalOptions.whitelistUrls.test && !this._globalOptions.whitelistUrls.test(fileurl)) {
            return;
        }

        let data = objectMerge(
            {
                // sentry.interfaces.Exception
                exception: {
                    values: [
                        {
                            type,
                            value: message,
                            stacktrace
                        }
                    ]
                },
                culprit: fileurl
            },
            options
        );

        // Fire away!
        this._send(data);
    },

    _trimPacket(data) {
        // For now, we only want to truncate the two different messages
        // but this could/should be expanded to just trim everything
        let max = this._globalOptions.maxMessageLength;
        if (data.message) {
            data.message = truncate(data.message, max);
        }
        if (data.exception) {
            let exception = data.exception.values[0];
            exception.value = truncate(exception.value, max);
        }

        let request = data.request;
        if (request) {
            if (request.url) {
                request.url = truncate(request.url, this._globalOptions.maxUrlLength);
            }
            if (request.Referer) {
                request.Referer = truncate(request.Referer, this._globalOptions.maxUrlLength);
            }
        }

        if (data.breadcrumbs && data.breadcrumbs.values) {
            this._trimBreadcrumbs(data.breadcrumbs);
        }

        return data;
    },

    /**
     * Truncate breadcrumb values (right now just URLs)
     */
    _trimBreadcrumbs(breadcrumbs) {
        // known breadcrumb properties with urls
        // TODO: also consider arbitrary prop values that start with (https?)?://
        let urlProps = ['to', 'from', 'url'],
            urlProp,
            crumb,
            data;

        for (let i = 0; i < breadcrumbs.values.length; ++i) {
            crumb = breadcrumbs.values[i];
            if (!crumb.hasOwnProperty('data') || !isObject(crumb.data) || objectFrozen(crumb.data)) {
                continue;
            }

            data = objectMerge({}, crumb.data);
            for (let j = 0; j < urlProps.length; ++j) {
                urlProp = urlProps[j];
                if (data.hasOwnProperty(urlProp) && data[urlProp]) {
                    data[urlProp] = truncate(data[urlProp], this._globalOptions.maxUrlLength);
                }
            }
            breadcrumbs.values[i].data = data;
        }
    },

    _getHttpData() {
        if (!this._hasNavigator && !this._hasDocument) {
            return {};
        }
        let httpData = {};

        if (this._hasNavigator && _navigator.userAgent) {
            httpData['User-Agent'] = navigator.userAgent;
        }

        // Check in `window` instead of `document`, as we may be in ServiceWorker environment
        if (_window.location && _window.location.href) {
            httpData.url = _window.location.href;
        }
        /*
        if (this._hasDocument && _document.referrer) {
            if (!httpData.headers) {
                httpData.headers = {};
            }
            httpData.headers.Referer = _document.referrer;
        }
        */
        return httpData;
    },

    _resetBackoff() {
        this._backoffDuration = 0;
        this._backoffStart = null;
    },

    _shouldBackoff() {
        return this._backoffDuration && now() - this._backoffStart < this._backoffDuration;
    },

    /**
     * Returns true if the in-process data payload matches the signature
     * of the previously-sent data
     *
     * NOTE: This has to be done at this level because TraceKit can generate
     *       data from window.onerror WITHOUT an exception object (IE8, IE9,
     *       other old browsers). This can take the form of an "exception"
     *       data object with a single frame (derived from the onerror args).
     */
    _isRepeatData(current) {
        let last = this._lastData;

        if (
            !last ||
            current.message !== last.message || // defined for captureMessage
            current.culprit !== last.culprit // defined for captureException/onerror
        ) {
            return false;
        }

        // Stacktrace interface (i.e. from captureMessage)
        if (current.stacktrace || last.stacktrace) {
            return isSameStacktrace(current.stacktrace, last.stacktrace);
        } else if (current.exception || last.exception) {
            // Exception interface (i.e. from captureException/onerror)
            return isSameException(current.exception, last.exception);
        }

        return true;
    },

    _setBackoffState(request) {
        // If we are already in a backoff state, don't change anything
        if (this._shouldBackoff()) {
            return;
        }

        let status = request.status;

        // 400 - project_id doesn't exist or some other fatal
        // 401 - invalid/revoked dsn
        // 429 - too many requests
        if (!(status === 400 || status === 401 || status === 429)) {
            return;
        }

        let retry;
        try {
            // If Retry-After is not in Access-Control-Expose-Headers, most
            // browsers will throw an exception trying to access it
            if (supportsFetch()) {
                retry = request.headers.get('Retry-After');
            } else {
                retry = request.getResponseHeader('Retry-After');
            }

            // Retry-After is returned in seconds
            retry = parseInt(retry, 10) * 1000;
        } catch (e) {
            /* eslint no-empty:0 */
        }

        this._backoffDuration = retry
            ? // If Sentry server returned a Retry-After value, use it
            retry
            : // Otherwise, double the last backoff duration (starts at 1 sec)
            this._backoffDuration * 2 || 1000;

        this._backoffStart = now();
    },

    _send(data) {
        let globalOptions = this._globalOptions;

        let baseData = {
                // project: this._globalProject,
                // logger: globalOptions.logger,
                // platform: 'javascript'
            },
            httpData = this._getHttpData();

        baseData = objectMerge(baseData, httpData);

        // HACK: delete `trimHeadFrames` to prevent from appearing in outbound payload
        if (data.trimHeadFrames) {
            delete data.trimHeadFrames;
        }

        data = objectMerge(baseData, data);

        // Merge in the tags and extra separately since objectMerge doesn't handle a deep merge
        data.tags = objectMerge(objectMerge({}, this._globalContext.tags), data.tags);
        data.extra = objectMerge(objectMerge({}, this._globalContext.extra), data.extra);

        // Send along our own collected metadata with extra
        data.extra['session:duration'] = now() - this._startTime;

        if (this._breadcrumbs && this._breadcrumbs.length > 0) {
            // intentionally make shallow copy so that additions
            // to breadcrumbs aren't accidentally sent in this request
            data.breadcrumbs = {
                values: [].slice.call(this._breadcrumbs, 0)
            };
        }

        if (this._raw_username) {
            data.username = this._raw_username;
        }
        if (globalOptions.appKey) {
            data.appKey = globalOptions.appKey;
        }

        // Include the environment if it's defined in globalOptions
        if (globalOptions.environment) {
            data.environment = globalOptions.environment;
        }

        // Include server_name if it's defined in globalOptions
        if (globalOptions.serverName) {
            data.server_name = globalOptions.serverName;
        }

        data = this._sanitizeData(data);

        // Cleanup empty properties before sending them to the server
        Object.keys(data).forEach((key) => {
            if (data[key] == null || data[key] === '' || isEmptyObject(data[key])) {
                delete data[key];
            }
        });

        if (isFunction(globalOptions.dataCallback)) {
            data = globalOptions.dataCallback(data) || data;
        }

        // Why??????????
        if (!data || isEmptyObject(data)) {
            return;
        }

        // Check if the request should be filtered or not
        if (isFunction(globalOptions.shouldSendCallback) && !globalOptions.shouldSendCallback(data)) {
            return;
        }

        // Backoff state: Sentry server previously responded w/ an error (e.g. 429 - too many requests),
        // so drop requests until "cool-off" period has elapsed.
        if (this._shouldBackoff()) {
            this._logDebug('warn', 'Hermes dropped error due to backoff: ', data);
            return;
        }

        if (typeof globalOptions.sampleRate === 'number') {
            if (Math.random() < globalOptions.sampleRate) {
                this._sendProcessedPayload(data);
            }
        } else {
            this._sendProcessedPayload(data);
        }
    },

    _sanitizeData(data) {
        return sanitize(data, this._globalOptions.sanitizeKeys);
    },

    _getUuid() {
        return uuid4();
    },

    _sendProcessedPayload(data, callback) {
        let self = this;
        let globalOptions = this._globalOptions;

        if (!this.isSetup()) {
            return;
        }

        // Try and clean up the packet before sending by truncating long values
        data = this._trimPacket(data);

        // ideally duplicate error testing should occur *before* dataCallback/shouldSendCallback,
        // but this would require copying an un-truncated copy of the data packet, which can be
        // arbitrarily deep (extra_data) -- could be worthwhile? will revisit
        if (!this._globalOptions.allowDuplicates && this._isRepeatData(data)) {
            this._logDebug('warn', 'Hermes dropped repeat event: ', data);
            return;
        }

        // Send along an event_id if not explicitly passed.
        // This event_id can be used to reference the error within Sentry itself.
        // Set lastEventId after we know the error should actually be sent
        this._lastEventId = data.event_id || (data.event_id = this._getUuid());

        // Store outbound payload after trim
        this._lastData = data;

        this._logDebug('debug', 'Hermes about to send:', data);

        let exception = data.exception && data.exception.values[0];
        if (exception) {
            data.type = exception.type;
            data.message = exception.value;
            for (let i = exception.stacktrace.frames.length - 1; i >= 0; i--) {
                if (exception.stacktrace.frames[i].colno && exception.stacktrace.frames[i].lineno) {
                    data.lineNo = exception.stacktrace.frames[i].lineno;
                    data.colNo = exception.stacktrace.frames[i].colno;
                    data.file = exception.stacktrace.frames[i].filename;
                    break;
                }
            }
        }

        // only capture 'sentry' breadcrumb is autoBreadcrumbs is truthy
        if (this._globalOptions.autoBreadcrumbs && this._globalOptions.autoBreadcrumbs.sentry) {
            this.captureBreadcrumb({
                message: exception ? (exception.type ? `${exception.type}: ` : '') + exception.value : data.message,
                event_id: data.event_id,
                level: data.level || 'error' // presume error unless specified
            });
        }

        let url = this._globalErrorEndpoint;
        (globalOptions.transport || this._makeRequest).call(this, {
            url,
            data,
            options: globalOptions,
            onSuccess: function success() {
                self._resetBackoff();

                self._triggerEvent('success', {
                    data,
                    src: url
                });
                callback && callback();
            },
            onError: function failure(error) {
                self._logDebug('error', 'Hermes transport failed to send: ', error);

                if (error.request) {
                    self._setBackoffState(error.request);
                }

                self._triggerEvent('failure', {
                    data,
                    src: url
                });
                error = error || new Error('Hermes send failed (no additional details provided)');
                callback && callback(error);
            }
        });
    },

    _makeRequest(opts) {
        let url = opts.url;

        let evaluatedHeaders = null;
        let evaluatedFetchParameters = {};

        if (opts.options.headers) {
            evaluatedHeaders = this._evaluateHash(opts.options.headers);
        }

        if (opts.options.fetchParameters) {
            evaluatedFetchParameters = this._evaluateHash(opts.options.fetchParameters);
        }

        if (supportsFetch()) {
            evaluatedFetchParameters.body = stringify(opts.data);

            let defaultFetchOptions = objectMerge({}, this._fetchDefaults);
            let fetchOptions = objectMerge(defaultFetchOptions, evaluatedFetchParameters);

            if (evaluatedHeaders) {
                fetchOptions.headers = evaluatedHeaders;
            }

            return _window
                .fetch(url, fetchOptions)
                .then((response) => {
                    if (response.ok) {
                        opts.onSuccess && opts.onSuccess();
                    } else {
                        let error = new Error(`Hermes error code: ${response.status}`);
                        // It's called request only to keep compatibility with XHR interface
                        // and not add more redundant checks in setBackoffState method
                        error.request = response;
                        opts.onError && opts.onError(error);
                    }
                })
                .catch(() => {
                    opts.onError && opts.onError(new Error('Hermes error code: network unavailable'));
                });
        }

        let request = _window.XMLHttpRequest && new _window.XMLHttpRequest();
        if (!request) {
            return;
        }

        // if browser doesn't support CORS (e.g. IE7), we are out of luck
        let hasCORS = 'withCredentials' in request || typeof XDomainRequest !== 'undefined';

        if (!hasCORS) {
            return;
        }

        if ('withCredentials' in request) {
            request.onreadystatechange = function() {
                if (request.readyState !== 4) {
                    return;
                } else if (request.status === 200) {
                    opts.onSuccess && opts.onSuccess();
                } else if (opts.onError) {
                    let err = new Error(`Hermes error code: ${request.status}`);
                    err.request = request;
                    opts.onError(err);
                }
            };
        } else {
            request = new XDomainRequest();
            // xdomainrequest cannot go http -> https (or vice versa),
            // so always use protocol relative
            url = url.replace(/^https?:/, '');

            // onreadystatechange not supported by XDomainRequest
            if (opts.onSuccess) {
                request.onload = opts.onSuccess;
            }
            if (opts.onError) {
                request.onerror = function() {
                    let err = new Error('Hermes error code: XDomainRequest');
                    err.request = request;
                    opts.onError(err);
                };
            }
        }

        request.open('POST', url);

        if (evaluatedHeaders) {
            each(evaluatedHeaders, (key, value) => {
                request.setRequestHeader(key, value);
            });
        }

        request.send(stringify(opts.data));
    },

    _evaluateHash(hash) {
        let evaluated = {};

        for (let key in hash) {
            if (hash.hasOwnProperty(key)) {
                let value = hash[key];
                evaluated[key] = typeof value === 'function' ? value() : value;
            }
        }

        return evaluated;
    },

    _logDebug(level) {
        // We allow `Hermes.debug` and `Hermes.config(DSN, { debug: true })` to not make backward incompatible API change
        if (this._originalConsoleMethods[level]) {
            // In IE<10 console methods do not have their own 'apply' method
            Function.prototype.apply.call(this._originalConsoleMethods[level], this._originalConsole, [].slice.call(arguments, 1));
        }
    },

    _mergeContext(key, context) {
        if (isUndefined(context)) {
            delete this._globalContext[key];
        } else {
            this._globalContext[key] = objectMerge(this._globalContext[key] || {}, context);
        }
    }
};

// Deprecations
Hermes.prototype.setUser = Hermes.prototype.setUserContext;

module.exports = Hermes;

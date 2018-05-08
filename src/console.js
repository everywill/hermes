let utils = require('./utils');

let wrapMethod = function(console, level, callback) {
    let originalConsoleLevel = console[level];
    let originalConsole = console;

    if (!(level in console)) {
        return;
    }

    let sentryLevel = level === 'warn' ? 'warning' : level;

    console[level] = function() {
        let args = [].slice.call(arguments);

        let msg = utils.safeJoin(args, ' ');
        let data = { level: sentryLevel, logger: 'console', extra: { arguments: args } };

        if (level === 'assert') {
            if (args[0] === false) {
                // Default browsers message
                msg = `Assertion failed: ${utils.safeJoin(args.slice(1), ' ') || 'console.assert'}`;
                data.extra.arguments = args.slice(1);
                callback && callback(msg, data);
            }
        } else {
            callback && callback(msg, data);
        }

        // this fails for some browsers. :(
        if (originalConsoleLevel) {
            // IE9 doesn't allow calling apply on console functions directly
            // See: https://stackoverflow.com/questions/5472938/does-ie9-support-console-log-and-is-it-a-real-function#answer-5473193
            Function.prototype.apply.call(originalConsoleLevel, originalConsole, args);
        }
    };
};

module.exports = {
    wrapMethod
};

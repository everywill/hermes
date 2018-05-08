function HermesConfigError(message) {
    this.name = 'HermesConfigError';
    this.message = message;
}
HermesConfigError.prototype = new Error();
HermesConfigError.prototype.constructor = HermesConfigError;

module.exports = HermesConfigError;

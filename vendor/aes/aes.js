const AES = require('crypto-js/aes');
const DEFAULT_KEY = '7a82fb3e5489cfffc42be3f0b9f9b2ac';

function encrypt(message) {
    return AES.encrypt(message, DEFAULT_KEY);
}

module.exports = encrypt;

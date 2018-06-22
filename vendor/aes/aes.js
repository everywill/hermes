const CryptoJS = require('crypto-js');
// AES KEY
const key = CryptoJS.enc.Hex.parse('7a82fb3e5489cfffc42be3f0b9f9b2ac');
const DEFAULT_KEY = CryptoJS.enc.Hex.parse('7a82fb3e5489cfffc42be3f0b9f9b2ac');

function encrypt(message) {
    return CryptoJS.AES.encrypt(message, DEFAULT_KEY, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
        iv: null
    })
        .ciphertext.toString()
        .toUpperCase();
}

module.exports = encrypt;

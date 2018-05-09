const path = require('path');

module.exports = {
    entry: path.resolve(__dirname, 'src/singleton'),
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'hermes.min.js'
    }
};

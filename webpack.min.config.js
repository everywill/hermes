const path = require('path');

module.exports = {
    mode: 'production',
    entry: path.resolve(__dirname, 'src/singleton'),
    devtool: false,
    output: {
        path: path.resolve(__dirname, 'dist'),
        library: 'Hermes',
        libraryTarget: 'umd',
        filename: 'hermes.min.js'
    },
    module: {
        rules: [
            {
                test: /\.(js|jsx)?$/,
                exclude: /node_modules/,
                loader: 'babel-loader',
                options: {
                    cacheDirectory: true
                }
            }
        ]
    }
};

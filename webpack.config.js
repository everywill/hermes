const path = require('path');

module.exports = {
    entry: path.resolve(__dirname, 'src/singleton'),
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
    },
    plugins: [],
    mode: 'development'
};

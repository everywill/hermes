const path = require('path');
const replace = require('rollup-plugin-replace');
const buble = require('rollup-plugin-buble');
const cjs = require('rollup-plugin-commonjs');
const node = require('rollup-plugin-node-resolve');
const version = process.env.VERSION || require('../package.json').version;

const resolve = p => path.resolve(__dirname, '../', p);

const entry = resolve('src/singleton.js');

const builds = {
    cjs: {
        entry,
        dest: resolve('dist/hermes.js'),
        format: 'cjs'
    },
    esm: {
        entry,
        dest: resolve('dist/hermes.esm.js'),
        format: 'es'
    },
    umd: {
        entry,
        dest: resolve('dist/hermes.min.js'),
        format: 'umd',
        env: 'production'
    }
};

function genConfig(name) {
    const opts = builds[name];
    const config = {
        input: opts.entry,
        output: {
            file: opts.dest,
            format: opts.format,
            name: opts.moduleName || 'Hermes'
        },
        plugins: [
            replace({
                __VERSION__: version
            }),
            buble(),
            node(),
            cjs()
        ].concat(opts.plugins || [])
    };

    if (opts.env) {
        config.plugins.push(
            replace({
                'process.env.NODE_ENV': JSON.stringify(opts.env)
            })
        );
    }

    return config;
}

if (process.env.TARGET) {
    module.exports = genConfig(process.env.TARGET);
} else {
    exports.getBuild = genConfig;
    exports.getAllBuilds = () => Object.keys(builds).map(genConfig);
}

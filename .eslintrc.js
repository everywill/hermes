module.exports = {
    root: true,
    extends: ['kaola/esnext'],
    parser: 'babel-eslint',
    parserOptions: {
        sourceType: 'module'
    },
    env: {
        browser: true
    },
    // add your custom rules here
    rules: {
        'no-unused-vars': ['error', { ignoreRestSiblings: true }],
        'max-statements': 'off',
        'no-use-before-define': 'off',
        camelcase: 'off'
    }
};

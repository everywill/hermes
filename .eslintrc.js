module.exports = {
  root: true,
  extends: ["plugin:prettier/recommended", "kaola/esnext"],
  parser: "babel-eslint",
  parserOptions: {
    sourceType: 'module'
  },
  env: {
    browser: true,
  },
  "plugins": ["prettier"],
  // add your custom rules here
  'rules': {
    'no-unused-vars': ["error", { "ignoreRestSiblings": true }]
  }
}

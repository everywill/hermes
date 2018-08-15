const path = require('path');
const NosClient = require('nos-node-sdk');
const pkg = require('../package.json');
require('dotenv').config();

const client = new NosClient();

client.setAccessId(process.env.ACCESS_KEY);
client.setSecretKey(process.env.SECRET_KEY);
client.setEndpoint(process.env.END_POINT);

client.put_file(
    {
        bucket: process.env.BUCKET,
        key: `hermes.min.${pkg.version}.js`,
        filepath: path.join(__dirname, '../dist', 'hermes.min.js')
    },
    (err, result) => {
        if (err) {
            console.log('SDK upload failed!');
            console.error(err);
            return;
        }
        console.log('SDK upload succeed!');
        console.log(result);
    }
);

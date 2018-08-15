const path = require('path');
const NosClient = require('nos-node-sdk');
const pkg = require('../package.json');
require('dotenv').config();

const client = new NosClient();

const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const END_POINT = process.env.END_POINT;
const BUCKET = process.env.BUCKET;

client.setAccessId(ACCESS_KEY);
client.setSecretKey(SECRET_KEY);
client.setEndpoint(END_POINT);

const filename = `hermes.min.${pkg.version}.js`;

console.log('Start uploading SDK...');

client.put_file(
    {
        bucket: BUCKET,
        key: filename,
        filepath: path.join(__dirname, '../dist', 'hermes.min.js')
    },
    (result) => {
        if (result.statusCode === 200) {
            console.log('Uploading succeed!');
            console.log(`check it on https://${BUCKET}.${END_POINT}/${filename}`);
        } else {
            console.log('SDK upload failed!');
        }
    }
);

const fs = require('fs');
const path = require('path');

const destFile = path.join(__dirname, '../dist/hermes.js');

fs.readFile(destFile, 'utf8', (err, data) => {
    if (err) {
        throw err;
    }
    let result = data.replace(/__NODE_ENV__/g, 'process.env.NODE_ENV');

    fs.writeFile(destFile, result, 'utf8', (err) => {
        if (err) {
            throw err;
        }
    });
});

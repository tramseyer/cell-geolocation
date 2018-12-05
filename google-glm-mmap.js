const https = require('https');

// Connection timeout, ms
let CONNECTION_TIMEOUT = 3000;

// error messages
const E_NOTFOUND = 'BTS not found';
const E_REQERROR = 'Request error';

/**
 * Perform request to Location Service.
 * Taken from https://github.com/kolonist/bscoords and kept unchaged.
 *
 * @param {object} options      Node.js HTTPS request options.
 * @param {*} request_body      Request body for POST requests. Can be String or
 *                              Buffer. If you do not need it you can pass null or
 *                              empty string ''.
 * @param {*} response_encoding Can be 'utf8' or 'hex' (for Google response).
 * @param {*} response_parser   Callback function(response) where `response` is
 *                              String with data from Location server. Callback
 *                              function should return object like
 *                              `{lat: 23.12345, lon: 50.12345, range: 1000}` or
 *                              null if there are no coordinates in the answer.
 */
const request = (options, request_body, response_encoding, response_parser) => {
    return new Promise((resolve, reject) => {
        const req = https.request(options, res => {
            res.setEncoding(response_encoding);

            // pick data
            let buf = '';
            res.on('data', chunk => buf += chunk);

            // all data came
            res.on('end', () => {
                const coords = response_parser(buf);

                if (coords !== null) {
                    return resolve(coords);
                } else {
                    return reject(new Error(E_NOTFOUND));
                }
            });
        });

        req.on('socket', socket => {
            socket.setTimeout(CONNECTION_TIMEOUT, () => req.abort());
        });

        req.on('error', err => reject(new Error(E_REQERROR)));

        if (options.method === 'POST' && request_body !== null && request_body !== '') {
            req.write(request_body);
        }

        req.end();
    });
};

/**
 * Get geographical coordinates from Google GLM MMAP (unofficial API).
 * Taken from https://github.com/kolonist/bscoords and modified to parse range.
 *
 * @param  {Number}  mcc Mobile Country Code
 * @param  {Number}  mnc Mobile Network Code
 * @param  {Number}  lac Location area code
 * @param  {Number}  cid Cell Identity
 * @return {Promise} Object containing lat, lon and range. If cell can not be resolved null.
 */
module.exports = {
    get: function (mcc, mnc, lac, cid) {
        const options = {
            hostname: 'www.google.com',
            method  : 'POST',
            path    : '/glm/mmap'
        };

        const request_body = Buffer.from(
            '000e00000000000000000000000000001b0000000000000000000000030000' +
            ('00000000' + Number(cid).toString(16)).substr(-8) +
            ('00000000' + Number(lac).toString(16)).substr(-8) +
            ('00000000' + Number(mnc).toString(16)).substr(-8) +
            ('00000000' + Number(mcc).toString(16)).substr(-8) +
            'ffffffff00000000',
            'hex'
        );

        const response_encoding = 'hex';


        /**
         * Convert 32-bit hex string into signed integer.
         * @param {String} hex Hex string like 'fab1c2d3'.
         */
        const hex2int = hex => {
            let int = parseInt(hex, 16);

            // negative number
            if ((int & 0x80000000) !== 0) {
                int = int - 0x100000000;
            }

            return int;
        };


        const response_parser = buf => {
            try {
                if (buf.length < 30) {
                    return null;
                }

                const coords = {
                    lat: hex2int(buf.slice(14, 22)) / 1000000,
                    lon: hex2int(buf.slice(22, 30)) / 1000000,
                    range: hex2int(buf.slice(30, 38))
                };

                if (coords.lat === 0 && coords.lon === 0) {
                    return null;
                }

                return coords;
            } catch(err) {
                return null;
            }
        };

        return request(options, request_body, response_encoding, response_parser);
    }
};

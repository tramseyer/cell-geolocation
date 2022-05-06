const https = require('https');

// Connection timeout, ms
let CONNECTION_TIMEOUT = 3000;

// error messages
const E_NOTFOUND = 'BTS not found';
const E_REQERROR = 'Request error';

/**
 * Perform request to Location Service.
 * Taken from https://github.com/kolonist/bscoords and modified to use https only.
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

module.exports = {
    /**
     * Get geographical coordinates from OpenCellId.
     * Taken from https://github.com/kolonist/bscoords and modified to parse range and code.
     *
     * @param  {Number}  mcc Mobile Country Code
     * @param  {Number}  mnc Mobile Network Code
     * @param  {Number}  lac Location area code
     * @param  {Number}  cid Cell Identity
     * @param  {String}  key OpenCellId API key
     * @return {Promise} Object containing lat, lon, range and status code. If there is a severe error null.
     */
    oci: function (mcc, mnc, lac, cid, key) {
        const options = {
            hostname: 'eu1.unwiredlabs.com',
            method  : 'POST',
            path    : '/v2/process.php'
        };

        const request_body = JSON.stringify({
            token: key,
            mcc: mcc,
            mnc: mnc,
            cells: [{
                lac: lac,
                cid: cid
            }]
        });
        const response_encoding = 'utf8';

        const response_parser = buf => {
            try {
                const answer = JSON.parse(buf);

                if (answer.balance === 0) {
                    const coords = {
                        lat: 0,
                        lon: 0,
                        range: 0,
                        statusCode: 429,
                        balance: answer.balance
                    };

                    return coords;
                } else if (answer.status === 'error') {
                    const coords = {
                        lat: 0,
                        lon: 0,
                        range: 0,
                        statusCode: 404,
                        balance: answer.balance
                    };

                    return coords;
                } else {
                    const coords = {
                        lat: answer.lat,
                        lon: answer.lon,
                        range: answer.accuracy,
                        statusCode: 200,
                        balance: answer.balance
                    };

                    return coords;
                }
            } catch(err) {
                return null;
            }
        };

        return request(options, request_body, response_encoding, response_parser);
    }
};

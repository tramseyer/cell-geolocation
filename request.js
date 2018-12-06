const https = require('https');

// Connection timeout, ms
let CONNECTION_TIMEOUT = 3000;

// error messages
const E_NOTFOUND = 'BTS not found';
const E_REQERROR = 'Request error';

// reg expression to fetch coordinates, range and code from OpenCellId response
const RE_FETCH_OPENCELLID_LAT  = /\slat="([+\-\d\.]+)"/i;
const RE_FETCH_OPENCELLID_LON  = /\slon="([+\-\d\.]+)"/i;
const RE_FETCH_OPENCELLID_RANGE  = /\srange="([+\-\d\.]+)"/i;
const RE_FETCH_OPENCELLID_CODE = /\scode="([+\-\d\.]+)"/i;

// error answer in OpenCellId response
const RE_OPENCELLID_ERROR = /err\s+info="[^"]+"\s+code="/i;

// quota exceeded answer for OpenCellId response
const RE_OPENCELLID_QUOTA = /exceeded/i

// quota exceeded answer for UnwiredLabs fallback response
const RE_UNWIREDLABS_QUOTA = /free/i

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

module.exports = {
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
    glm: function (mcc, mnc, lac, cid) {
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
    },

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
            hostname: 'opencellid.org',
            method  : 'GET',
            path    : `/cell/get?key=${key}&mnc=${mnc}&mcc=${mcc}&lac=${lac}&cellid=${cid}`
        };

        const request_body = null;
        const response_encoding = 'utf8';

        const response_parser = buf => {
            console.log(buf);
            try {
                if (RE_OPENCELLID_QUOTA.test(buf) || RE_UNWIREDLABS_QUOTA.test(buf)) {
                    const coords = {
                        lat: 0,
                        lon: 0,
                        range: 0,
                        statusCode: 429
                    };

                    return coords;
                } else if (RE_OPENCELLID_ERROR.test(buf)) {
                    const coords = {
                        lat: 0,
                        lon: 0,
                        range: 0,
                        statusCode: 404
                    };

                    return coords;
                } else {
                    const coords = {
                        lat: Number(RE_FETCH_OPENCELLID_LAT.exec(buf)[1]),
                        lon: Number(RE_FETCH_OPENCELLID_LON.exec(buf)[1]),
                        range: Number(RE_FETCH_OPENCELLID_RANGE.exec(buf)[1]),
                        statusCode: 200
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

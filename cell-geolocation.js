var http = require('http');
var sqlite3 = require('sqlite3');
var path = require('path');
var Url = require('url');
var util = require('util');
var ociDb = new sqlite3.Database(path.join(__dirname, 'oci_cells.sqlite'));
var mlsDb = new sqlite3.Database(path.join(__dirname, 'mls_cells.sqlite'));
var ggaDb = new sqlite3.Database(path.join(__dirname, 'gga_cells.sqlite'));

if (typeof process.env.GOOGLE_GEOLOCATION_API_KEY != 'undefined') {
  var gga = require ('google-geolocation') ({
    key: process.env.GOOGLE_GEOLOCATION_API_KEY
  });
  console.log('Using Google Geolocation API key:', process.env.GOOGLE_GEOLOCATION_API_KEY);
} else {
  console.warn('No Google Geolocation API key supplied via: GOOGLE_GEOLOCATION_API_KEY');
}

const defaultLocation = '{"lat":46.910542,"lon":7.359761,"range":4294967295,"source":"none"}'

http.createServer(function(req, res) {
  var url = Url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  if (req.method === 'GET' && url.pathname === '/') {
    if (!url.query.mcc || !url.query.mnc || !url.query.lac || !url.query.cellid) {
      res.writeHead(404);
      return res.end('Need mcc, mnc, lac, cellid passed in as query parameters');
    }

    // -1- query OpenCellId database
    ociDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
      1: url.query.mcc,
      2: url.query.mnc,
      3: url.query.lac,
      4: url.query.cellid
    }, function(err, row) {
      if (err) {
        console.error('Error querying OpenCellId database');
        res.writeHead(500);
        res.end(JSON.stringify(err));
        return;
      }

      // -2- if OpenCellId database did not have a match, query Mozilla Location Service database
      if (typeof row == 'undefined') {
        mlsDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
          1: url.query.mcc,
          2: url.query.mnc,
          3: url.query.lac,
          4: url.query.cellid
        }, function(err, row) {
          if (err) {
            console.error('Error querying Mozilla Location Service database');
            res.writeHead(500);
            res.end(JSON.stringify(err));
            return;
          }

          // -3- if Mozilla Location Service database did not have a match, query Google Geolocation API cache database
          if (typeof row == 'undefined') {
            ggaDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
              1: url.query.mcc,
              2: url.query.mnc,
              3: url.query.lac,
              4: url.query.cellid
            }, function(err, row) {
              if (err) {
                console.error('Error querying Google Geolocation API cache database');
                res.writeHead(500);
                res.end(JSON.stringify(err));
                return;
              }

              // -4- if Google Geolocation API cache database did not have a match, query Google Geolocation API
              if (typeof row == 'undefined') {
                var cell = {
                  cellTowers: [
                    {
                      mobileCountryCode: url.query.mcc,
                      mobileNetworkCode: url.query.mnc,
                      locationAreaCode: url.query.lac,
                      cellId: url.query.cellid
                    }
                  ]
                };
                gga(cell, (err, data) => {
                  if (err) {
                    // -5- use default location if a match is nowhere to be found
                    console.log('Replying with default location because cell not found', url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid);
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(defaultLocation);
                    return;
                  }
                  console.log(data);
                  ggaDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                    1: url.query.mcc,
                    2: url.query.mnc,
                    3: url.query.lac,
                    4: url.query.cellid,
                    5: data.location.lat,
                    6: data.location.lng,
                    7: data.accuracy
                  }, function(err, result) {
                    if (err) {
                      console.error('Error inserting into Google Geolocation API cache database');
                      res.writeHead(500);
                      res.end(JSON.stringify(err));
                      return;
                    }
                    console.log(util.format('Queried Google Geolocation API: %s, %s, %s, %s -> %s, %s, %s',
                                url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                data.location.lat, data.location.lng, data.accuracy));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(util.format('{"lat":%d,"lon":%d,"range":%d,source:"%s"}',
                                        data.location.lat, data.location.lng, data.accuracy, 'Google'));
                    return;
                  });
                });
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                row.source = 'Google';
                res.end(JSON.stringify(row));
              }
            });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            row.source = 'Mozilla';
            res.end(JSON.stringify(row));
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        row.source = 'OpenCellId';
        res.end(JSON.stringify(row));
      }
    });
  }
  else {
    res.writeHead(404);
    res.end('Nothing to see here');
  }

}).listen(process.env.PORT || 5265, process.env.IP || '0.0.0.0');

process.on('exit', function() {
  ociDb.close();
  mlsDb.close();
  ggaDb.close();
});

console.log('Running at port:', process.env.PORT || 5265);

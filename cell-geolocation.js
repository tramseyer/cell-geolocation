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

const defaultLatitude = 46.910542;
const defaultLongitude = 7.359761;
const defaultRange = 4294967295;

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
                    if (err.statusCode == 404) {
                      // -5- use default location if a match is nowhere to be found
                      ggaDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                        1: url.query.mcc,
                        2: url.query.mnc,
                        3: url.query.lac,
                        4: url.query.cellid,
                        5: defaultLatitude,
                        6: defaultLongitude,
                        7: defaultRange
                      }, function(err, result) {
                        if (err) {
                          console.error('Error inserting default location into Google Geolocation API cache database');
                          res.writeHead(500);
                          res.end(JSON.stringify(err));
                          return;
                        }
                        console.log(util.format('Replying with default location to %s due to 404: %s, %s, %s, %s',
                                    req.connection.remoteAddress,
                                    url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid));
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(util.format('{"lat":%d,"lon":%d,"range":%d}',
                                defaultLatitude, defaultLongitude, defaultRange));
                        return;
                      });
                    } else {
                      // Remark: If quotas are exceeded, the statusCode should be 403
                      console.log(util.format('Replying with default location to %s due to %d: %s, %s, %s, %s',
                                  req.connection.remoteAddress, err.statusCode,
                                  url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid));
                      res.writeHead(404, { 'Content-Type': 'application/json' });
                      res.end(util.format('{"lat":%d,"lon":%d,"range":%d}',
                              defaultLatitude, defaultLongitude, defaultRange));
                      return;
                    }
                  } else {
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
                        console.error('Error inserting queried location into Google Geolocation API cache database');
                        res.writeHead(500);
                        res.end(JSON.stringify(err));
                        return;
                      }
                      console.log(util.format('Queried Google Geolocation API for %s: %s, %s, %s, %s -> %s, %s, %s',
                                  req.connection.remoteAddress,
                                  url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                  data.location.lat, data.location.lng, data.accuracy));
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(util.format('{"lat":%d,"lon":%d,"range":%d}', data.location.lat, data.location.lng, data.accuracy));
                      return;
                    });
                  }
                });
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(row));
              }
            });
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(row));
          }
        });
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(row));
      }
    });
  } else {
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

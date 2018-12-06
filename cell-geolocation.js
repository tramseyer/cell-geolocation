const http = require('http');
const sqlite3 = require('sqlite3');
const path = require('path');
const Url = require('url');
const util = require('util');
const request = require(path.join(__dirname,'./request.js'));
const ociDb = new sqlite3.Database(path.join(__dirname, 'oci_cells.sqlite'), sqlite3.OPEN_READONLY);
const mlsDb = new sqlite3.Database(path.join(__dirname, 'mls_cells.sqlite'), sqlite3.OPEN_READONLY);
const glmDb = new sqlite3.Database(path.join(__dirname, 'glm_cells.sqlite'), sqlite3.OPEN_READWRITE);
const uwlDb = new sqlite3.Database(path.join(__dirname, 'uwl_cells.sqlite'), sqlite3.OPEN_READWRITE);

const defaultLatitude = 46.909009;
const defaultLongitude = 7.360584;
const defaultRange = 4294967295;

const OPENCELLID_API_KEY = process.env.OPENCELLID_API_KEY;
if (typeof OPENCELLID_API_KEY != 'undefined') {
  console.log('Using OpenCellId API key:', OPENCELLID_API_KEY);
} else {
  console.warn('No OpenCellId API key supplied via: OPENCELLID_API_KEY');
}

var numValidRequests = 0;

http.createServer(function(req, res) {
  const url = Url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  if (req.method === 'GET' && url.pathname === '/') {
    if (!url.query.mcc || !url.query.mnc || !url.query.lac || !url.query.cellid) {
      res.writeHead(400);
      return res.end('Need mcc, mnc, lac, cellid passed in as query parameters');
    } else if (url.query.mcc > 999) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(util.format('{"lat":%d,"lon":%d,"range":%d}',
              defaultLatitude, defaultLongitude, defaultRange));
      return;
    }

    numValidRequests++;

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

          // -3- if Mozilla Location Service database did not have a match, query GLM MMAP cache database
          if (typeof row == 'undefined') {
            glmDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
              1: url.query.mcc,
              2: url.query.mnc,
              3: url.query.lac,
              4: url.query.cellid
            }, function(err, row) {
              if (err) {
                console.error('Error querying Google GLM MMAP cache database');
                res.writeHead(500);
                res.end(JSON.stringify(err));
                return;
              }

              // -4- if Google GLM MMAP cache database did not have a match, query Google GLM MMAP
              if (typeof row == 'undefined') {
                request.glm(url.query.mcc,url.query.mnc,url.query.lac,url.query.cellid).then(coords => {
                  glmDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                    1: url.query.mcc,
                    2: url.query.mnc,
                    3: url.query.lac,
                    4: url.query.cellid,
                    5: coords.lat,
                    6: coords.lon,
                    7: coords.range
                  }, function(err, result) {
                    if (err) {
                      console.error('Error inserting queried location into Google GLM MMAP cache database');
                      res.writeHead(500);
                      res.end(JSON.stringify(err));
                      return;
                    }
                    console.log(util.format('Queried Google GLM MMAP for %s: %s, %s, %s, %s -> %s, %s, %s',
                                req.connection.remoteAddress,
                                url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                coords.lat, coords.lon, coords.range));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(util.format('{"lat":%d,"lon":%d,"range":%d}', coords.lat, coords.lon, coords.range));
                    return;
                  });
                }).catch(err => {
                  // -5- Google GLM MMAP did not have a match, query OpenCellId cache database
                  uwlDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
                    1: url.query.mcc,
                    2: url.query.mnc,
                    3: url.query.lac,
                    4: url.query.cellid
                  }, function(err, row) {
                    if (err) {
                      console.error('Error querying OpenCellId cache database');
                      res.writeHead(500);
                      res.end(JSON.stringify(err));
                      return;
                    }

                    // -6- if OpenCellId cache database did not have a match, query OpenCellId
                    if (typeof row == 'undefined') {
                      request.oci(url.query.mcc,url.query.mnc,url.query.lac,url.query.cellid, OPENCELLID_API_KEY).then(coords => {
                        if (coords.statusCode == 200) { // ok
                          uwlDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                            1: url.query.mcc,
                            2: url.query.mnc,
                            3: url.query.lac,
                            4: url.query.cellid,
                            5: coords.lat,
                            6: coords.lon,
                            7: coords.range
                          }, function(err, result) {
                            if (err) {
                              console.error('Error inserting queried location into OpenCellId cache database');
                              res.writeHead(500);
                              res.end(JSON.stringify(err));
                              return;
                            }
                            console.log(util.format('Queried OpenCellId for %s: %s, %s, %s, %s -> %s, %s, %s',
                                        req.connection.remoteAddress,
                                        url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                        coords.lat, coords.lon, coords.range));
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(util.format('{"lat":%d,"lon":%d,"range":%d}', coords.lat, coords.lon, coords.range));
                            return;
                          });
                        }
                        else if (coords.statusCode == 404) { // cell not found
                          // -7- use default location if a match is nowhere to be found
                          uwlDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                            1: url.query.mcc,
                            2: url.query.mnc,
                            3: url.query.lac,
                            4: url.query.cellid,
                            5: defaultLatitude,
                            6: defaultLongitude,
                            7: defaultRange
                          }, function(err, result) {
                            if (err) {
                              console.error('Error inserting default location into OpenCellId cache database');
                              res.writeHead(500);
                              res.end(JSON.stringify(err));
                              return;
                            }
                            console.log(util.format('Req#%d: Replying with default location to %s due to %d: %s, %s, %s, %s',
                                        numValidRequests, req.connection.remoteAddress, coords.statusCode,
                                        url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid));
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(util.format('{"lat":%d,"lon":%d,"range":%d}',
                                    defaultLatitude, defaultLongitude, defaultRange));
                            return;
                          });
                        } else if (coords.statusCode == 429) { // daily limit of UnwiredLabs requests exceeded
                            console.log(util.format('Req#%d: Replying with default location to %s due to %d: %s, %s, %s, %s',
                                        numValidRequests, req.connection.remoteAddress, coords.statusCode,
                                        url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid));
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(util.format('{"lat":%d,"lon":%d,"range":%d}',
                                    defaultLatitude, defaultLongitude, defaultRange));
                            return;
                        }
                      }).catch(err => {
                        console.warn(err);
                        res.writeHead(500);
                        res.end(JSON.stringify(err));
                        return;
                      });
                    } else {
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify(row));
                    }
                  });
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
  glmDb.close();
  uwlDb.close();
});

console.log('Running at port:', process.env.PORT || 5265);

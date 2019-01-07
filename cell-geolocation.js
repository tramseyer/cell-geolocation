const http = require('http');
const sqlite3 = require('sqlite3');
const path = require('path');
const Url = require('url');
const util = require('util');
const fs = require('fs');
const request = require(path.join(__dirname, 'request.js'));
const ociDb = new sqlite3.Database(path.join(__dirname, 'oci_cells.sqlite'), sqlite3.OPEN_READONLY);
const mlsDb = new sqlite3.Database(path.join(__dirname, 'mls_cells.sqlite'), sqlite3.OPEN_READONLY);
const glmDb = new sqlite3.Database(path.join(__dirname, 'glm_cells.sqlite'), sqlite3.OPEN_READWRITE);
const uwlDb = new sqlite3.Database(path.join(__dirname, 'uwl_cells.sqlite'), sqlite3.OPEN_READWRITE);
const ownDb = new sqlite3.Database(path.join(__dirname, 'own_cells.sqlite'), sqlite3.OPEN_READWRITE);

const approximatedRange = 2147483648;

const defaultLatitude = 46.909009;
const defaultLongitude = 7.360584;
const defaultRange = 4294967295;

const ociDbMtime = new Date(fs.statSync(path.join(__dirname, 'oci_cells.sqlite')).mtime).getTime()/1000|0;
console.log('Main database (OpenCellId) last modifed at:', ociDbMtime);

const OPENCELLID_API_KEY = process.env.OPENCELLID_API_KEY;
if (typeof OPENCELLID_API_KEY != 'undefined') {
  console.log('Using OpenCellId API key:', OPENCELLID_API_KEY);
} else {
  console.warn('No OpenCellId API key supplied via: OPENCELLID_API_KEY');
}

// https://carto.com/blog/center-of-points/
const CENTER_OF_CELLS_QUERY = '\
SELECT \
  s.avg_lat AS lat, \
  180 * atan2(s.zeta, s.xi) / pi() AS lon \
FROM \
  ( \
  SELECT  \
    avg(lat) AS avg_lat, \
    avg(sin(pi() * lon / 180)) AS zeta, \
    avg(cos(pi() * lon / 180)) AS xi \
  FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? \
  ) AS s'

ociDb.loadExtension(path.join(__dirname,'libsqlitefunctions.so'), function(err) {
  if (err) {
    console.error('Could not load libsqlitefunctions.so extension');
  }
});

var numValidRequests = 0;
var numOpenCellIdResponses = 0;
var numMozillaResponses = 0;
var numGoogleResponses = 0;
var numUnwiredLabsResponses = 0;
var numApproximatedResponses = 0;
var numDefaultResponses = 0;

var numApproximatedCells = 0;
var numUnknownCells = 0;

http.createServer(function(req, res) {
  const url = Url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  if (req.method === 'GET' && url.pathname === '/') {
    if (!url.query.mcc || !url.query.mnc || !url.query.lac || !url.query.cellid) {
      res.writeHead(400);
      return res.end('Need mcc, mnc, lac, cellid passed in as query parameters');
    } else if ((url.query.mcc > 999) || (url.query.mnc > 999) || (url.query.lac > 65535) || (url.query.cellid > 268435455)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({"lat":defaultLatitude,"lon":defaultLongitude,"range":defaultRange}));
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

              // -4- if Google GLM MMAP cache database did not have a match, query OpenCellId cache database
              if (typeof row == 'undefined') {
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

                  // -5- if OpenCellId cache database did not have a match, query own cache database
                  if (typeof row == 'undefined') {
                    ownDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
                      1: url.query.mcc,
                      2: url.query.mnc,
                      3: url.query.lac,
                      4: url.query.cellid
                    }, function(err, row) {
                      if (err) {
                        console.error('Error querying own cache database');
                        res.writeHead(500);
                        res.end(JSON.stringify(err));
                        return;
                      }

                      // -6- if OpenCellId cache database did not have a match, query Google GLM MMAP online service
                      if (typeof row == 'undefined') {
                        request.glm(url.query.mcc,url.query.mnc,url.query.lac,url.query.cellid).then(coords => {
                          glmDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', {
                            1: url.query.mcc,
                            2: url.query.mnc,
                            3: url.query.lac,
                            4: url.query.cellid,
                            5: coords.lat,
                            6: coords.lon,
                            7: coords.range,
                            8: Math.floor(new Date().getTime()/1000|0),
                            9: Math.floor(new Date().getTime()/1000|0)
                          }, function(err, result) {
                            if (err) {
                              console.error('Error inserting queried location into Google GLM MMAP cache database');
                              res.writeHead(500);
                              res.end(JSON.stringify(err));
                              return;
                            }
                            console.log(util.format('Req#%d O#%d M#%d G#%d U#%d Own#%d/%d A#%d D#%d: Queried Google GLM MMAP for %s: %s, %s, %s, %s -> %s, %s, %s',
                                        numValidRequests, numOpenCellIdResponses, numMozillaResponses, numGoogleResponses, numUnwiredLabsResponses,
                                        numApproximatedResponses, numDefaultResponses, numApproximatedCells, numUnknownCells,
                                        req.connection.remoteAddress,
                                        url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                        coords.lat, coords.lon, coords.range));
                            numGoogleResponses++;
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({"lat":coords.lat,"lon":coords.lon,"range":coords.range}));
                            return;
                          });
                        }).catch(err => {
                          // -7- if Google GLM MMAP did not have a match, query OpenCellId online service
                          request.oci(url.query.mcc,url.query.mnc,url.query.lac,url.query.cellid, OPENCELLID_API_KEY).then(coords => {
                            if (coords.statusCode == 200) { // ok
                              uwlDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', {
                                1: url.query.mcc,
                                2: url.query.mnc,
                                3: url.query.lac,
                                4: url.query.cellid,
                                5: coords.lat,
                                6: coords.lon,
                                7: coords.range,
                                8: Math.floor(new Date().getTime()/1000|0),
                                9: Math.floor(new Date().getTime()/1000|0)
                              }, function(err, result) {
                                if (err) {
                                  console.error('Error inserting queried location into OpenCellId cache database');
                                  res.writeHead(500);
                                  res.end(JSON.stringify(err));
                                  return;
                                }
                                console.log(util.format('Req#%d O#%d M#%d G#%d U#%d Own#%d/%d A#%d D#%d: Queried OpenCellId for %s: %s, %s, %s, %s -> %s, %s, %s',
                                            numValidRequests, numOpenCellIdResponses, numMozillaResponses, numGoogleResponses, numUnwiredLabsResponses,
                                            numApproximatedResponses, numDefaultResponses, numApproximatedCells, numUnknownCells,
                                            req.connection.remoteAddress,
                                            url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                            coords.lat, coords.lon, coords.range));
                                numUnwiredLabsResponses++;
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({"lat":coords.lat,"lon":coords.lon,"range":coords.range}));
                                return;
                              });
                            }
                            else if (coords.statusCode == 404) { // cell not found
                              // -8a- if OpenCellId did not have a match, query OpenCellId database and calculate approximate location
                              ociDb.get(CENTER_OF_CELLS_QUERY, {
                                1: url.query.mcc,
                                2: url.query.mnc,
                                3: url.query.lac
                              }, function(err, row) {
                                if (err) {
                                  console.error('Error querying OpenCellId database');
                                  res.writeHead(500);
                                  res.end(JSON.stringify(err));
                                  return;
                                } else if ((null != row.lat) && (null != row.lon)) {
                                  numApproximatedCells++;
                                  ownDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', {
                                    1: url.query.mcc,
                                    2: url.query.mnc,
                                    3: url.query.lac,
                                    4: url.query.cellid,
                                    5: row.lat,
                                    6: row.lon,
                                    7: approximatedRange,
                                    8: Math.floor(new Date().getTime()/1000|0),
                                    9: Math.floor(new Date().getTime()/1000|0)
                                  }, function(err, result) {
                                    if (err) {
                                      console.error('Error inserting default location into own cache database');
                                      res.writeHead(500);
                                      res.end(JSON.stringify(err));
                                      return;
                                    }
                                    console.log(util.format('Req#%d O#%d M#%d G#%d U#%d Own#%d/%d A#%d D#%d: Replying with approximated location to %s due to %d: %s, %s, %s, %s -> %s, %s, %s',
                                                numValidRequests, numOpenCellIdResponses, numMozillaResponses, numGoogleResponses, numUnwiredLabsResponses,
                                                numApproximatedResponses, numDefaultResponses, numApproximatedCells, numUnknownCells,
                                                req.connection.remoteAddress, coords.statusCode,
                                                url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                                           row.lat,row.lon,approximatedRange));
                                    numApproximatedResponses++;
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({"lat":row.lat,"lon":row.lon,"range":approximatedRange}));
                                    return;
                                  });
                                } else {
                                  // -9a- use default location if approximate location could not be calculated
                                  numUnknownCells++;
                                  ownDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', {
                                    1: url.query.mcc,
                                    2: url.query.mnc,
                                    3: url.query.lac,
                                    4: url.query.cellid,
                                    5: defaultLatitude,
                                    6: defaultLongitude,
                                    7: defaultRange,
                                    8: Math.floor(new Date().getTime()/1000|0),
                                    9: Math.floor(new Date().getTime()/1000|0)
                                  }, function(err, result) {
                                    if (err) {
                                      console.error('Error inserting default location into own cache database');
                                      res.writeHead(500);
                                      res.end(JSON.stringify(err));
                                      return;
                                    }
                                    console.log(util.format('Req#%d O#%d M#%d G#%d U#%d Own#%d/%d A#%d D#%d: Replying with default location to %s due to %d: %s, %s, %s, %s',
                                                numValidRequests, numOpenCellIdResponses, numMozillaResponses, numGoogleResponses, numUnwiredLabsResponses,
                                                numApproximatedResponses, numDefaultResponses, numApproximatedCells, numUnknownCells,
                                                req.connection.remoteAddress, coords.statusCode,
                                                url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid));
                                    numDefaultResponses++;
                                    res.writeHead(404, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({"lat":defaultLatitude,"lon":defaultLongitude,"range":defaultRange}));
                                    return;
                                  });
                                }
                              });
                            } else if (coords.statusCode == 429) { // daily limit of UnwiredLabs requests exceeded
                              // -8b- if OpenCellId did not have a match, query OpenCellId database and calculate approximate location
                              ociDb.get(CENTER_OF_CELLS_QUERY, {
                                1: url.query.mcc,
                                2: url.query.mnc,
                                3: url.query.lac
                              }, function(err, row) {
                                if (err) {
                                  console.error('Error querying OpenCellId database');
                                  res.writeHead(500);
                                  res.end(JSON.stringify(err));
                                  return;
                                } else if ((null != row.lat) && (null != row.lon)) {
                                  numApproximatedCells++;
                                  ownDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                                    1: url.query.mcc,
                                    2: url.query.mnc,
                                    3: url.query.lac,
                                    4: url.query.cellid,
                                    5: row.lat,
                                    6: row.lon,
                                    7: approximatedRange
                                  }, function(err, result) {
                                    if (err) {
                                      console.error('Error inserting default location into own cache database');
                                      res.writeHead(500);
                                      res.end(JSON.stringify(err));
                                      return;
                                    }
                                    console.log(util.format('Req#%d O#%d M#%d G#%d U#%d Own#%d/%d A#%d D#%d: Replying with approximated location to %s due to %d: %s, %s, %s, %s -> %s, %s, %s',
                                                numValidRequests, numOpenCellIdResponses, numMozillaResponses, numGoogleResponses, numUnwiredLabsResponses,
                                                numApproximatedResponses, numDefaultResponses, numApproximatedCells, numUnknownCells,
                                                req.connection.remoteAddress, coords.statusCode,
                                                url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid,
                                                row.lat, row.lon, approximatedRange));
                                    numApproximatedResponses++;
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({"lat":row.lat,"lon":row.lon,"range":approximatedRange}));
                                    return;
                                  });
                                } else {
                                  // -9b- use default location if approximate location could not be calculated
                                  numUnknownCells++;
                                  ownDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                                    1: url.query.mcc,
                                    2: url.query.mnc,
                                    3: url.query.lac,
                                    4: url.query.cellid,
                                    5: defaultLatitude,
                                    6: defaultLongitude,
                                    7: defaultRange
                                  }, function(err, result) {
                                    if (err) {
                                      console.error('Error inserting default location into own cache database');
                                      res.writeHead(500);
                                      res.end(JSON.stringify(err));
                                      return;
                                    }
                                    console.log(util.format('Req#%d O#%d M#%d G#%d U#%d Own#%d/%d A#%d D#%d: Replying with default location to %s due to %d: %s, %s, %s, %s',
                                                numValidRequests, numOpenCellIdResponses, numMozillaResponses, numGoogleResponses, numUnwiredLabsResponses,
                                                numApproximatedResponses, numDefaultResponses, numApproximatedCells, numUnknownCells,
                                                req.connection.remoteAddress, coords.statusCode,
                                                url.query.mcc, url.query.mnc, url.query.lac, url.query.cellid));
                                    numDefaultResponses++;
                                    res.writeHead(404, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({"lat":defaultLatitude,"lon":defaultLongitude,"range":defaultRange}));
                                    return;
                                  });
                                }
                              });
                            }
                          }).catch(err => {
                            console.warn(err);
                            res.writeHead(500);
                            res.end(JSON.stringify(err));
                            return;
                          });
                        });
                      } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        if (approximatedRange == row.range) {
                          numApproximatedResponses++;
                          res.end(JSON.stringify(row));
                        } else {
                          numDefaultResponses++;
                          res.end(JSON.stringify(row));
                        }
                      }
                    });
                  } else {
                    numUnwiredLabsResponses++;
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(row));
                  }
                });
              } else {
                numGoogleResponses++;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(row));
              }
            });
          } else {
            numMozillaResponses++;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(row));
          }
        });
      } else {
        numOpenCellIdResponses++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(row));
      }
    });
  } else if (req.method === 'GET' && url.pathname === '/version') { 
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(ociDbMtime);
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
  ownDb.close();
});

console.log('Running at port:', process.env.PORT || 5265);

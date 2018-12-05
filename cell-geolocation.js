const http = require('http');
const sqlite3 = require('sqlite3');
const path = require('path');
const Url = require('url');
const util = require('util');
const glm = require(path.join(__dirname,'./google-glm-mmap.js'));
const ociDb = new sqlite3.Database(path.join(__dirname, 'oci_cells.sqlite'), sqlite3.OPEN_READONLY);
const mlsDb = new sqlite3.Database(path.join(__dirname, 'mls_cells.sqlite'), sqlite3.OPEN_READONLY);
const glmDb = new sqlite3.Database(path.join(__dirname, 'glm_cells.sqlite'), sqlite3.OPEN_READWRITE);

const defaultLatitude = 46.910542;
const defaultLongitude = 7.359761;
const defaultRange = 4294967295;

http.createServer(function(req, res) {
  const url = Url.parse(req.url, true);

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

          // -3- if Mozilla Location Service database did not have a match, query GLM MMAPlocation API cache database
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
                glm.get(url.query.mcc,url.query.mnc,url.query.lac,url.query.cellid).then(coords => {
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
                  // -5- use default location if a match is nowhere to be found
                  glmDb.run('INSERT INTO cells (mcc, mnc, lac, cellid, lat, lon, range) VALUES(?,?,?,?,?,?,?)', {
                    1: url.query.mcc,
                    2: url.query.mnc,
                    3: url.query.lac,
                    4: url.query.cellid,
                    5: defaultLatitude,
                    6: defaultLongitude,
                    7: defaultRange
                  }, function(err, result) {
                    if (err) {
                      console.error('Error inserting default location into Google GLM MMAP cache database');
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
});

console.log('Running at port:', process.env.PORT || 5265);

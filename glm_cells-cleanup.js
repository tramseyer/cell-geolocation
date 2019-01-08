const sqlite3 = require('sqlite3');
const path = require('path');
const util = require('util');
const mlsDb = new sqlite3.Database(path.join(__dirname, 'mls_cells.sqlite'), sqlite3.OPEN_READONLY);
const ociDb = new sqlite3.Database(path.join(__dirname, 'oci_cells.sqlite'), sqlite3.OPEN_READONLY);
const glmDb = new sqlite3.Database(path.join(__dirname, 'glm_cells.sqlite'), sqlite3.OPEN_READWRITE);

var numProcessedEntries = 0;

glmDb.each("SELECT mcc, mnc, lac, cellid FROM cells", function(err, glmRow) {
  if (err) {
    console.error('Error querying Google GLM MMAP cache database');
    return;
  } else {
    numProcessedEntries++;
    mlsDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
      1: glmRow.mcc,
      2: glmRow.mnc,
      3: glmRow.lac,
      4: glmRow.cellid
    }, function(err, row) {
      if (err) {
        console.error('Error querying Mozilla Location Service database');
        return;
      }

      if (typeof row != 'undefined') {
        glmDb.run('DELETE FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
          1: glmRow.mcc,
          2: glmRow.mnc,
          3: glmRow.lac,
          4: glmRow.cellid
        }, function(err) {
          if (err) {
            console.error('Error removing entry in Google GLM MMAP cache database');
            return;
          } else {
            console.log(util.format('Removed %d %d %d %d because already in OpenCellId database', glmRow.mcc, glmRow.mnc, glmRow.lac, glmRow.cellid));
            return;
          }
        });
      } else {
        ociDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
          1: glmRow.mcc,
          2: glmRow.mnc,
          3: glmRow.lac,
          4: glmRow.cellid
        }, function(err, row) {
          if (err) {
            console.error('Error querying OpenCellId database');
            return;
          }

          if (typeof row != 'undefined') {
            glmDb.run('DELETE FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
              1: glmRow.mcc,
              2: glmRow.mnc,
              3: glmRow.lac,
              4: glmRow.cellid
            }, function(err) {
              if (err) {
                console.error('Error removing entry in Google GLM MMAP cache database');
                return;
              } else {
                console.log(util.format('Removed %d %d %d %d because already in Mozilla Location Service database', glmRow.mcc, glmRow.mnc, glmRow.lac, glmRow.cellid));
                return;
              }
            });
          }
        });
      }
    });
  }
});

process.on('exit', function() {
  mlsDb.close();
  ociDb.close();
  glmDb.close();
  console.log(util.format('Processed entries: %d', numProcessedEntries));
});

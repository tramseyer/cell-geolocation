const sqlite3 = require('sqlite3');
const path = require('path');
const util = require('util');
const mlsDb = new sqlite3.Database(path.join(__dirname, 'mls_cells.sqlite'), sqlite3.OPEN_READONLY);
const ociDb = new sqlite3.Database(path.join(__dirname, 'oci_cells.sqlite'), sqlite3.OPEN_READONLY);
const uwlDb = new sqlite3.Database(path.join(__dirname, 'uwl_cells.sqlite'), sqlite3.OPEN_READWRITE);

var numProcessedEntries = 0;

uwlDb.each("SELECT mcc, mnc, lac, cellid FROM cells", function(err, uwlRow) {
  if (err) {
    console.error('Error querying OpenCellId cache database');
    return;
  } else {
    numProcessedEntries++;
    mlsDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
      1: uwlRow.mcc,
      2: uwlRow.mnc,
      3: uwlRow.lac,
      4: uwlRow.cellid
    }, function(err, row) {
      if (err) {
        console.error('Error querying Mozilla Location Service database');
        return;
      }

      if (typeof row != 'undefined') {
        uwlDb.run('DELETE FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
          1: uwlRow.mcc,
          2: uwlRow.mnc,
          3: uwlRow.lac,
          4: uwlRow.cellid
        }, function(err) {
          if (err) {
            console.error('Error removing entry in OpenCellId cache database');
            return;
          } else {
            console.log(util.format('Removed %d %d %d %d because already in OpenCellId database', uwlRow.mcc, uwlRow.mnc, uwlRow.lac, uwlRow.cellid));
            return;
          }
        });
      } else {
        ociDb.get('SELECT lat, lon, range FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
          1: uwlRow.mcc,
          2: uwlRow.mnc,
          3: uwlRow.lac,
          4: uwlRow.cellid
        }, function(err, row) {
          if (err) {
            console.error('Error querying OpenCellId database');
            return;
          }

          if (typeof row != 'undefined') {
            uwlDb.run('DELETE FROM cells WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', {
              1: uwlRow.mcc,
              2: uwlRow.mnc,
              3: uwlRow.lac,
              4: uwlRow.cellid
            }, function(err) {
              if (err) {
                console.error('Error removing entry in OpenCellId cache database');
                return;
              } else {
                console.log(util.format('Removed %d %d %d %d because already in Mozilla Location Service database', uwlRow.mcc, uwlRow.mnc, uwlRow.lac, uwlRow.cellid));
                return;
              }
            });
          }
        });
      }
    });
  }
});

process.on('SIGHUP', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGQUIT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGTSTP', shutdown);
function shutdown() {
  mlsDb.close();
  ociDb.close();
  uwlDb.close();
  console.log("");
  console.log("Closed databases and exiting now")
  process.exit(0);
}

process.on('beforeExit', function() {
  mlsDb.close();
  ociDb.close();
  uwlDb.close();
  console.log(util.format('Processed entries: %d', numProcessedEntries));
  process.exit(0);
});

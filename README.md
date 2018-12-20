# Self hosted cell tower geolocation server

A self hosted cell tower geolocation server inspired by [Jan Jongboom](https://github.com/janjongboom/opencellid).

You'll want to use this if you want to have the most complete, free and self hosted cell tower geolocation server.

Underneath the hood, the following data sources are used in descending order:
1. [OpenCellId: offline database](https://www.opencellid.org/downloads.php)
2. [Mozilla Location Service: offline database](https://location.services.mozilla.com/downloads)
3. Google GLM MMAP: self created cache database
4. OpenCellId (effectively a fallback to UnwiredLabs): self created cache database
5. Own cache database with approximated and default locations
6. [Google GLM MMAP: online service](https://github.com/kolonist/bscoords)
7. [OpenCellId (effectively a fallback to UnwiredLabs): online service](http://wiki.opencellid.org/wiki/API)
8. Approximated location according to midpoint of towers from OpenCellId offline database with same MCC, MNC and LAC (range: 2147483648)
9. Default location (lat: 46.909009, lon: 7.360584, range: 4294967295)

![](overview.png)

Remark: The OpenBmap / Radiocells.org offline database is not used, because it is considered tiny compared to the OpenCellId and Mozilla Location Service databases.

## Installation (database creation)

### SQLite extension-functions.c

    sudo apt-get install -y libsqlite3-dev
    wget -O extension-functions.c https://www.sqlite.org/contrib/download/extension-functions.c?get=25
    gcc -fPIC -lm -shared extension-functions.c -o libsqlitefunctions.so

### OpenCellId database

    wget -O oci_cells.csv.gz "https://download.unwiredlabs.com/ocid/downloads?token=<YOUR_OPENCELLID_API_KEY>&file=cell_towers.csv.gz"
    cat oci_cells.csv.gz | gunzip - > oci_cells.csv
    cat schema.sql | sqlite3 oci_cells.sqlite
    cat oci_import.sql | sqlite3 oci_cells.sqlite

### Mozilla Location Service database

    wget -O mls_cells.csv.gz "https://d17pt8qph6ncyq.cloudfront.net/export/MLS-full-cell-export-$(date -u "+%Y-%m-%d")T000000.csv.gz"
    cat mls_cells.csv.gz | gunzip - > mls_cells.csv
    cat schema.sql | sqlite3 mls_cells.sqlite
    cat mls_import.sql | sqlite3 mls_cells.sqlite

### Google GLM MMAP cache database

    cat cache_schema.sql | sqlite3 glm_cells.sqlite

### OpenCellId (effectively a fallback to UnwiredLabs) cache database

    cat cache_schema.sql | sqlite3 uwl_cells.sqlite

### Approximated and default cache database

    cat cache_schema.sql | sqlite3 own_cells.sqlite

## Running

Start the server:

    npm install
    OPENCELLID_API_KEY=<YOURS> node cell-geolocation.js

Use environment variables PORT and IP for different port/host. F.e.:

    PORT=1337 OPENCELLID_API_KEY=<YOURS> node cell-geolocation.js

## Queries and Responses (as of December 2018)

Query which can be answered by using the OpenCellId database (1):

    curl -s 'http://localhost:5265/?mcc=228&mnc=1&lac=505&cellid=10545'
    {"lat":47.492113,"lon":8.466422,"range":15744}

Query which can be answered by using the Mozilla Location Service database (2):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=203&cellid=48045204'
    {"lat":51.4649645,"lon":4.3089691,"range":47}

Query which can be answered by using the Google GLM MMAP online service (6):

    curl -s 'http://localhost:5265/?mcc=206&mnc=1&lac=3034&cellid=65927425'
    {"lat":51.184073,"lon":4.36019,"range":1210}

Query which can now be answered by using the Google GLM MMAP cache database (3):

    curl -s 'http://localhost:5265/?mcc=206&mnc=1&lac=3034&cellid=65927425'
    {"lat":51.184073,"lon":4.36019,"range":1210}

Query which can be answered by using the OpenCellId online service (7):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=212&cellid=48053995'
    {"lat":51.999298,"lon":6.26473,"range":318}

Query which can now be answered by using the OpenCellId cache database (4):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=212&cellid=48053995'
    {"lat":51.999298,"lon":6.26473,"range":318}

Query with non-existing cell tower which can be answered by using the approximated location (8):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=212&cellid=99999999'
    {"lat":51.80883396670778,"lon":5.773024994544559,"range":2147483648}

Query which can now be answered by using the own cache database (5):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=212&cellid=99999999'
    {"lat":51.80883396670778,"lon":5.773024994544559,"range":2147483648}

Query with non-existing cell tower which can only be answered by using the default location (9):

    curl -s 'http://localhost:5265/?mcc=0&mnc=0&lac=0&cellid=0'
    curl -s 'http://localhost:5265/?mcc=3100&mnc=41&lac=42971&cellid=9906077'
    {"lat":46.909009,"lon":7.360584,"range":4294967295}

The output is always a JSON object that has lat, lon and range.

## Maintenance

Remove entries in Google GLM MMAP cache database which are present in OpenCellId database or Mozilla Location Service database:

    node glm_cells-cleanup.js
    echo "VACUUM;" | sqlite3 glm_cells.sqlite

Remove entries in OpenCellId cache database which are present in OpenCellId database, Mozilla Location Service database, Google GLM MMAP cache database or online service:

    node uwl_cells-cleanup.js
    echo "VACUUM;" | sqlite3 uwl_cells.sqlite

Remove approximated locations in the own cache database (useful when assuming that the corresponding cells are now known by higher priority sources):

    echo "DELETE FROM cells WHERE range=2147483648;" | sqlite3 own_cells.sqlite
    echo "VACUUM;" | sqlite3 own_cells.sqlite

Remove default locations in the own cache database (useful when assuming that the corresponding cells are now known by higher priority sources):

    echo "DELETE FROM cells WHERE range=4294967295;" | sqlite3 own_cells.sqlite
    echo "VACUUM;" | sqlite3 own_cells.sqlite

Remove duplicate entries in Google GLM MMAP, OpenCellId and own cache database:

    echo "DELETE FROM cells WHERE rowid NOT IN (SELECT min(rowid) FROM cells GROUP BY mcc, mnc, lac, cellid);" | sqlite3 glm_cells.sqlite
    echo "VACUUM;" | sqlite3 glm_cells.sqlite
    echo "DELETE FROM cells WHERE rowid NOT IN (SELECT min(rowid) FROM cells GROUP BY mcc, mnc, lac, cellid);" | sqlite3 uwl_cells.sqlite
    echo "VACUUM;" | sqlite3 uwl_cells.sqlite
    echo "DELETE FROM cells WHERE rowid NOT IN (SELECT min(rowid) FROM cells GROUP BY mcc, mnc, lac, cellid);" | sqlite3 own_cells.sqlite
    echo "VACUUM;" | sqlite3 own_cells.sqlite

Find duplicate entries in Google GLM MMAP and OpenCellId cache database:

    echo "SELECT mcc, mnc, lac, cellid, count(*) as cell FROM cells GROUP BY mcc, mnc, lac, cellid HAVING count(*)> 1;" | sqlite3 glm_cells.sqlite
    echo "SELECT mcc, mnc, lac, cellid, count(*) as cell FROM cells GROUP BY mcc, mnc, lac, cellid HAVING count(*)> 1;" | sqlite3 uwl_cells.sqlite
    echo "SELECT mcc, mnc, lac, cellid, count(*) as cell FROM cells GROUP BY mcc, mnc, lac, cellid HAVING count(*)> 1;" | sqlite3 own_cells.sqlite

## Resources

OpenCellId and Mozilla Location Service [CSV Cell Fields](https://mozilla.github.io/ichnaea/import_export.html) definition.

## License

Released under the [WTFPL version 2](http://sam.zoy.org/wtfpl/).

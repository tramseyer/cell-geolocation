# Self hosted cell tower geolocation server

A self hosted cell tower geolocation server inspired by [Jan Jongboom](https://github.com/janjongboom/opencellid).

You'll want to use this if you want to have the most complete, free and self hosted cell tower geolocation server.

Underneath the hood, the following data sources are used in descending order:
1. [OpenCellId: offline database](https://www.opencellid.org/downloads.php)
2. [Mozilla Location Service: offline database](https://location.services.mozilla.com/downloads)
3. Google GLM MMAP: self created cache database
4. OpenCellId (effectively a fallback to UnwiredLabs): self created cache database
5. [Google GLM MMAP: online service](https://github.com/kolonist/bscoords)
6. [OpenCellId (effectively a fallback to UnwiredLabs): online service](http://wiki.opencellid.org/wiki/API)
7. Default location (Latitude = 46.909009, Longitude = 7.360584 and Range = 4294967295)

![](overview.png)

Remark: The OpenBmap / Radiocells.org database is not used, because it is considered tiny compared to the OpenCellId and Mozilla Location Service databases.

## Installation (database creation)

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

Query which can be answered by using the Google GLM MMAP online service (5):

    curl -s 'http://localhost:5265/?mcc=206&mnc=1&lac=3034&cellid=65927425'
    {"lat":51.183995,"lon":4.360154,"range":1204}

Query which can now be answered by using the Google GLM MMAP cache database (3):

    curl -s 'http://localhost:5265/?mcc=206&mnc=1&lac=3034&cellid=65927425'
    {"lat":51.088892,"lon":4.456987,"range":1492}

Query which can be answered by using the OpenCellId online service (6):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=207&cellid=48051720'
    {"lat":50.970299,"lon":5.79788,"range":4545}

Query which can now be answered by using the OpenCellId cache database (4):

    curl -s 'http://localhost:5265/?mcc=204&mnc=4&lac=207&cellid=48051720'
    {"lat":50.970299,"lon":5.79788,"range":4545}

Query with non-existing cell tower which can only be answered by using the default location (7):

    curl -s 'http://localhost:5265/?mcc=999&mnc=4&lac=207&cellid=48051720'
    curl -s 'http://localhost:5265/?mcc=3100&mnc=41&lac=42971&cellid=9906077'
    {"lat":46.909009,"lon":7.360584,"range":4294967295}

The output is always a JSON object that has lat, lon and range.

## Maintenance

Remove entries in Google GLM MMAP cache database which are present in OpenCellId database or Mozilla Location Service database:

    node glm_cells-cleanup.js
    echo "VACUUM;" | sqlite3 glm_cells.sqlite
    
Remove entries in OpenCellId cache database which are present in OpenCellId database, Mozilla Location Service database, Google GLM MMAP cache database or online service:

    node uwl-cells-cleanup.js
    echo "VACUUM;" | sqlite3 uwl_cells.sqlite

Remove default locations in the OpenCellId cache database (useful when assuming that the corresponding cells are now known by either Google GLM MMAP or OpenCellId):

    echo "DELETE FROM cells WHERE range=4294967295;" sqlite3 uwl_cells.sqlite
    echo "VACUUM;" | sqlite3 uwl_cells.sqlite

## Resources

OpenCellId and Mozilla Location Service [CSV Cell Fields](https://mozilla.github.io/ichnaea/import_export.html) definition.

## License

Released under the [WTFPL version 2](http://sam.zoy.org/wtfpl/).

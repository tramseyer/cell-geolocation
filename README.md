# Self hosted cell tower geolocation server

A self hosted cell tower geolocation server inspired by [Jan Jongboom](https://github.com/janjongboom/opencellid).

Underneath the hood, the following data sources are used in the following order:
1. [OpenCellId: offline database](https://www.opencellid.org/downloads.php)
2. [Mozilla Location Service: offline database](https://location.services.mozilla.com/downloads)
3. Google Geolocation API: self created cache database
4. [Google Geolocation API: online service](https://developers.google.com/maps/documentation/geolocation/intro)
5. Default location (Latitude = 46.910542, Longitude = 7.359761 and Range = 4294967295)

You'll want to use this if you want to have the most complete, free, self hosted cell tower geolocation server.
As of July 16, 2018 the Google Geolocation API allows up to 40000 Geolocation API request per month for free.
It is recommended to set the Quotas [here](https://console.cloud.google.com/google/maps-apis/apis/geolocation.googleapis.com/quotas)
or [here](https://console.cloud.google.com/iam-admin/quotas) to ensure cost control.
Whereas a limit of 1290 Geolocation API request per day are the maximum to not exceed 200$ (monthy free credit).

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
    
### Google Geolocation API cache database

    cat gga_schema.sql | sqlite3 gga_cells.sqlite

## Running

Start the server:

    npm install
    GOOGLE_GEOLOCATION_API_KEY=<YOURS> node cell-geolocation.js

Use environment variables PORT and IP for different port/host. F.e.:

    PORT=1337 GOOGLE_GEOLOCATION_API_KEY=<YOURS> node cell-goelocation.js

## Queries

    curl -s 'http://localhost:5265/?mcc=228&mnc=1&lac=505&cellid=10545'
    curl -s 'http://localhost:5265/?mcc=222&mnc=10&lac=16085&cellid=26855411'
    curl -s 'http://localhost:5265/?mcc=1&mnc=2&lac=3&cellid=4'
    curl -s 'http://localhost:5265/?mcc=0&mnc=0&lac=0&cellid=0'

The output is a JSON object that has lat, lon and range.

## Maintenance

Remove default locations in the Google Geolocation API cache database:

    sqlite3 gga_cells.sqlite
    DELETE FROM cells WHERE range=4294967295;
    VACUUM;

## Resources

OpenCellId and Mozilla Location Service [CSV Cell Fields](https://mozilla.github.io/ichnaea/import_export.html) definition.

## License

Released under the [WTFPL version 2](http://sam.zoy.org/wtfpl/).

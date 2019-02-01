from multiprocessing import Pool
import binascii
import os
import requests
import sqlite3
import sys
import time

startTimeScript = time.time()
entryCount = 0
hitCount = 0
missCount = 0
timeoutErrorCount = 0
connectionErrorCount = 0
coordinateErrorCount = 0
valueErrorCount = 0

# https://github.com/mapado/haversine
from math import radians, cos, sin, asin, sqrt
def haversine(point1, point2, unit='km'):
    """ Calculate the great-circle distance between two points on the Earth surface.
    :input: two 2-tuples, containing the latitude and longitude of each point
    in decimal degrees.
    Keyword arguments:
    unit -- a string containing the initials of a unit of measurement (i.e. miles = mi)
            default 'km' (kilometers).
    Example: haversine((45.7597, 4.8422), (48.8567, 2.3508))
    :output: Returns the distance between the two points.
    The default returned unit is kilometers. The default unit can be changed by
    setting the unit parameter to a string containing the initials of the desired unit.
    Other available units are miles (mi), nautic miles (nmi), meters (m),
    feets (ft) and inches (in).
    """
    # mean earth radius - https://en.wikipedia.org/wiki/Earth_radius#Mean_radius
    AVG_EARTH_RADIUS_KM = 6371.0088

    # Units values taken from http://www.unitconversion.org/unit_converter/length.html
    conversions = {'km': 1,
                   'm': 1000,
                   'mi': 0.621371192,
                   'nmi': 0.539956803,
                   'ft': 3280.839895013,
                   'in': 39370.078740158}

    # get earth radius in required units
    avg_earth_radius = AVG_EARTH_RADIUS_KM * conversions[unit]

    # unpack latitude/longitude
    lat1, lng1 = point1
    lat2, lng2 = point2

    # convert all latitudes/longitudes from decimal degrees to radians
    lat1, lng1, lat2, lng2 = map(radians, (lat1, lng1, lat2, lng2))

    # calculate haversine
    lat = lat2 - lat1
    lng = lng2 - lng1
    d = sin(lat * 0.5) ** 2 + cos(lat1) * cos(lat2) * sin(lng * 0.5) ** 2

    return 2 * avg_earth_radius * asin(sqrt(d))

def queryGlmMmap(args):
    a = '000E00000000000000000000000000001B0000000000000000000000030000'
    b = hex(args[3])[2:].zfill(8) + hex(args[2])[2:].zfill(8)
    c = hex(args[1])[2:].zfill(8) + hex(args[0])[2:].zfill(8)
    string = binascii.unhexlify(a + b + c + 'FFFFFFFF00000000')

    try:
        proxy = {'http': 'http://' + args[7]} if args[8] else {}
        response = requests.post('http://www.google.com/glm/mmap', string, proxies=proxy, timeout=5)
        r = binascii.hexlify(response.content)
        if 0 == int(r[6:14],16):
            lat = float(int(r[14:22],16))/1000000
            lon = float(int(r[22:30],16))/1000000
            rng = int(r[30:38],16)
            if 90.0 < abs(lat):
                print('Unrealistic lat:', lat, hex(lat))
                return -3, args, lat, lon, rng
            elif 180.0 < abs(lon):
                print('Unrealistic lon:', lon, hex(lon))
                return -3, args, lat, lon, rng
            elif 1000000 < rng:
                print('Unrealistic range:', rng)
                return -4, args, lat, lon, rng
            elif 20037.5 < haversine((args[4], args[5]), (lat, lon)):
                print('Unrealistic distance:', haversine((args[4], args[5]), (lat, lon)))
                return -4, args, lat, lon, rng
            else:
                return 0, args, lat, lon, rng
        else:
            return 1, args, None, None, None
    except requests.Timeout as e:
        return -1, args, None, None, None
    except Exception as e:
        return -2, args, None, None, None

pool = Pool(int(sys.argv[2]))

response = requests.get('https://www.proxy-list.download/api/v1/get?&type=http&anon=elite', timeout=30)
httpProxies = response.text.splitlines()
response = requests.get('https://www.proxy-list.download/api/v1/get?&type=https&anon=elite', timeout=30)
httpsProxies = response.text.splitlines()
allProxies = httpProxies + httpsProxies
print('Fetched {0} HTTP and {1} HTTPS elite proxies'.format(len(httpProxies), len(httpsProxies)))
useProxies = True if len(sys.argv) > 3 and 'prox' in sys.argv[3] else False
if useProxies:
    print('Using proxies for requests')
else:
    print('Not using proxies for requests')

db = sqlite3.connect(sys.argv[1])
dbCursor = db.cursor()
dbCursor.execute('SELECT COUNT(*) FROM cells WHERE updated_at < {0}'.format(int(startTimeScript)))
entriesCount = dbCursor.fetchone()[0]

startTimeRequests = time.time()

pendingRowsArgs = []

while True:
    dbCursor.execute('SELECT mcc, mnc, lac, cellid, lat, lon, range FROM cells WHERE updated_at < {0}'.format(int(startTimeScript)))
    rows = dbCursor.fetchmany(int((len(allProxies)/8)))
    if rows:
        args = []
        for i, row in enumerate(rows):
            args.append((row[0], row[1], row[2], row[3], row[4], row[5], row[6], allProxies[i], useProxies))
        results = pool.map(queryGlmMmap, args)
        movedProxiesCount = 0;
        for result in results:
            ret, args, lat, lon, rng = result
            if 0 == ret:
                hitCount += 1
                db.cursor().execute('UPDATE cells SET lat = ?, lon = ?, range = ?, updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (lat,lon, rng, int(time.time()), args[0], args[1], args[2], args[3]))
            elif 1 == ret:
                missCount += 1
                pendingRowsArgs.append(list(args[0:7]))
                db.cursor().execute('UPDATE cells SET updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (int(time.time()), args[0], args[1], args[2], args[3]))
            elif -1 == ret:
                timeoutErrorCount += 1
                if useProxies:
                    movedProxiesCount += 1
                    allProxies.remove(args[7])
                    allProxies.append(args[7])
            elif -2 == ret:
                connectionErrorCount += 1
                if useProxies:
                    movedProxiesCount += 1
                    allProxies.remove(args[7])
                    allProxies.append(args[7])
            elif -3 == ret:
                coordinateErrorCount += 1
                missCount += 1
                pendingRowsArgs.append(list(args[0:7]))
                db.cursor().execute('UPDATE cells SET updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (int(time.time()), args[0], args[1], args[2], args[3]))
            elif -4 == ret:
                valueErrorCount += 1
                missCount += 1
                pendingRowsArgs.append(list(args[0:7]))
                db.cursor().execute('UPDATE cells SET updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (int(time.time()), args[0], args[1], args[2], args[3]))
        db.commit()
        updatedCount = hitCount + missCount + coordinateErrorCount + valueErrorCount
        updatedPercentage = 100.0 / entriesCount * updatedCount
        hitPercentage = 100.0 / entriesCount * hitCount
        missPercentage = 100.0 / entriesCount * missCount
        print('C:{0} U:{1}/{2:.2f}% H:{3:.2f}% M:{4:.2f}% E:{5},{6},{7},{8} P:{9} R:{10}/s'.format(entriesCount, updatedCount, updatedPercentage, hitPercentage, missPercentage, timeoutErrorCount, connectionErrorCount, coordinateErrorCount, valueErrorCount, movedProxiesCount, int(updatedCount / (time.time() - startTimeRequests))))
    else:
        break

if len(pendingRowsArgs):
    retryEntriesCount = len(pendingRowsArgs)
    hitCount = 0
    missCount = 0
    timeoutErrorCount = 0
    connectionErrorCount = 0
    coordinateErrorCount = 0
    valueErrorCount = 0
    print('Retrying {0} entries'.format(retryEntriesCount))
    previousPendingRowsArgsLen = len(pendingRowsArgs) + 1
    while len(pendingRowsArgs) < previousPendingRowsArgsLen:
        previousPendingRowsArgsLen = len(pendingRowsArgs)
        for pos in range(0, len(pendingRowsArgs), int((len(allProxies)/8))):
            rows = pendingRowsArgs[pos:pos+int((len(allProxies)/8))]
            args = []
            for i, row in enumerate(rows):
                args.append((row[0], row[1], row[2], row[3], row[4], row[5], row[6], allProxies[i], useProxies))
            results = pool.map(queryGlmMmap, args)
            movedProxiesCount = 0;
            for result in results:
                ret, args, lat, lon, rng = result
                if 0 == ret:
                    hitCount += 1
                    db.cursor().execute('UPDATE cells SET lat = ?, lon = ?, range = ?, updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (lat,lon, rng, int(time.time()), args[0], args[1], args[2], args[3]))
                    pendingRowsArgs.remove(list(args[0:7]))
                elif 1 == ret:
                    missCount += 1
                elif -1 == ret:
                    timeoutErrorCount += 1
                    if useProxies:
                        movedProxiesCount += 1
                        allProxies.remove(args[7])
                        allProxies.append(args[7])
                elif -2 == ret:
                    connectionErrorCount += 1
                    if useProxies:
                        movedProxiesCount += 1
                        allProxies.remove(args[7])
                        allProxies.append(args[7])
                elif -3 == ret:
                    coordinateErrorCount += 1
                elif -4 == ret:
                    valueErrorCount += 1
            db.commit()
            hitPercentage = 100.0 / retryEntriesCount * hitCount
            print('R:{0} H:{1}/{2:.2f}% E:{3},{4},{5},{6} P:{7} R:{8}/s'.format(retryEntriesCount, hitCount, hitPercentage, timeoutErrorCount, connectionErrorCount, coordinateErrorCount, valueErrorCount, movedProxiesCount, int(updatedCount / (time.time() - startTimeRequests))))
    print('No hits for {0} entries'.format(len(pendingRowsArgs)))

db.close()
pool.close()

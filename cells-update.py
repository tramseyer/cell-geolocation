from multiprocessing import Pool
import binascii
import os
import requests
import sqlite3
import sys
import time

entryCount = 0
hitCount = 0
missCount = 0
timeoutErrorCount = 0
connectionErrorCount = 0
coordinateErrorCount = 0
valueErrorCount = 0
sleepTime = 0
startTime = time.time()
pendingRowsArgs = []

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
                #print('Unrealistic lat:', lat, hex(int(r[14:22],16)))
                return -3, args, lat, lon, rng
            elif 180.0 < abs(lon):
                #print('Unrealistic lon:', lon, hex(int(r[22:30],16)))
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

def fetchProxies():
    response = requests.get('https://www.proxy-list.download/api/v1/get?&type=http&anon=elite', timeout=30)
    httpProxies = response.text.splitlines()
    response = requests.get('https://www.proxy-list.download/api/v1/get?&type=https&anon=elite', timeout=30)
    httpsProxies = response.text.splitlines()
    print('Fetched {0} HTTP and {1} HTTPS elite proxies'.format(len(httpProxies), len(httpsProxies)))
    return httpProxies + httpsProxies

db = sqlite3.connect(sys.argv[1])
dbCursor = db.cursor()
dbCursor.execute('SELECT COUNT(*) FROM cells WHERE updated_at < {0}'.format(int(startTime)))
entriesCount = dbCursor.fetchone()[0]

allProxies = fetchProxies()
useProxies = True if len(sys.argv) > 3 and 'prox' in sys.argv[3] else False
if useProxies:
    print('Querying {0} entries while using proxies'.format(entriesCount))
else:
    print('Querying {0} entries while not using proxies'.format(entriesCount))

pool = Pool(int(sys.argv[2]))

while True:
    dbCursor.execute('SELECT mcc, mnc, lac, cellid, lat, lon, range FROM cells WHERE updated_at < {0}'.format(int(startTime)))
    rows = dbCursor.fetchmany(int((len(allProxies)/8)) if useProxies else int(sys.argv[2]))
    if rows:
        currentMissCount = 0
        currentTimeoutErrorCount = 0
        currentConnectionErrorCount = 0
        args = []
        for i, row in enumerate(rows):
            args.append((row[0], row[1], row[2], row[3], row[4], row[5], row[6], allProxies[i] if useProxies else None, useProxies))
        results = pool.map(queryGlmMmap, args)
        movedProxiesCount = 0;
        for result in results:
            ret, args, lat, lon, rng = result
            if 0 == ret:
                hitCount += 1
                db.cursor().execute('UPDATE cells SET lat = ?, lon = ?, range = ?, updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (lat,lon, rng, int(time.time()), args[0], args[1], args[2], args[3]))
            elif 1 == ret:
                currentMissCount += 1
                missCount += 1
                pendingRowsArgs.append(list(args[0:7]))
                db.cursor().execute('UPDATE cells SET updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (int(time.time()), args[0], args[1], args[2], args[3]))
            elif -1 == ret:
                currentTimeoutErrorCount += 1
                timeoutErrorCount += 1
                if useProxies:
                    movedProxiesCount += 1
                    allProxies.remove(args[7])
                    allProxies.append(args[7])
            elif -2 == ret:
                currentConnectionErrorCount += 1
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
        if not useProxies and currentTimeoutErrorCount + currentConnectionErrorCount == len(rows): # connection error
            sleepTime += 1
        if not useProxies and currentMissCount == len(rows): # IP address banned by Google
            sleepTime += 1
        elif useProxies and currentConnectionErrorCount >= (len(rows) / 2): # IP address banned by 50% of proxies or more
            sleepTime += 1
        elif sleepTime > 0:
            sleepTime -= 1
        updatedCount = hitCount + missCount + coordinateErrorCount + valueErrorCount
        updatedPercentage = 100.0 / entriesCount * updatedCount
        hitPercentage = 100.0 / entriesCount * hitCount
        missPercentage = 100.0 / entriesCount * missCount
        print('C:{0} U:{1}/{2:.2f}% H:{3}/{4:.2f}% M:{5}/{6:.2f}% E:{7},{8},{9},{10} P:{11} R:{12}/s S:{13}s'.format(entriesCount, updatedCount, updatedPercentage, hitCount, hitPercentage, missCount, missPercentage, timeoutErrorCount, connectionErrorCount, coordinateErrorCount, valueErrorCount, movedProxiesCount, int(updatedCount / (time.time() - startTime)), sleepTime))
        if not useProxies and sleepTime >= 30: # constant connection error or IP address banned by Google
            print('Switching to using proxies now')
            useProxies = True
            sleepTime = 0
        else:
            time.sleep(sleepTime)
    else:
        break

if len(pendingRowsArgs):
    print('Retrying {0} entries using proxies now'.format(len(pendingRowsArgs)))
    while True:
        hitRowsArgs = []
        hitCount = 0
        missCount = 0
        timeoutErrorCount = 0
        connectionErrorCount = 0
        coordinateErrorCount = 0
        valueErrorCount = 0
        sleepTime = 0
        startTime = time.time()
        allProxies = fetchProxies()
        retryEntriesCount = len(pendingRowsArgs)
        for pos in range(0, len(pendingRowsArgs), int((len(allProxies)/8))):
            rows = pendingRowsArgs[pos:pos+int((len(allProxies)/8))]
            currentConnectionErrorCount = 0
            args = []
            for i, row in enumerate(rows):
                args.append((row[0], row[1], row[2], row[3], row[4], row[5], row[6], allProxies[i], True))
            results = pool.map(queryGlmMmap, args)
            movedProxiesCount = 0;
            for result in results:
                ret, args, lat, lon, rng = result
                if 0 == ret:
                    hitCount += 1
                    db.cursor().execute('UPDATE cells SET lat = ?, lon = ?, range = ?, updated_at = ? WHERE mcc = ? AND mnc = ? AND lac = ? AND cellid = ?', (lat,lon, rng, int(time.time()), args[0], args[1], args[2], args[3]))
                    hitRowsArgs.append(list(args[0:7]))
                elif 1 == ret:
                    currentMissCount += 1
                    missCount += 1
                elif -1 == ret:
                    timeoutErrorCount += 1
                    movedProxiesCount += 1
                    allProxies.remove(args[7])
                    allProxies.append(args[7])
                elif -2 == ret:
                    currentConnectionErrorCount += 1
                    connectionErrorCount += 1
                    movedProxiesCount += 1
                    allProxies.remove(args[7])
                    allProxies.append(args[7])
                elif -3 == ret:
                    coordinateErrorCount += 1
                elif -4 == ret:
                    valueErrorCount += 1
            db.commit()
            if currentConnectionErrorCount >= (len(rows) / 2): # IP address banned by 50% of proxies or more
                sleepTime += 1
            elif sleepTime > 0:
                sleepTime -= 1
            updatedCount = hitCount + missCount + timeoutErrorCount + connectionErrorCount + coordinateErrorCount + valueErrorCount
            updatedPercentage = 100.0 / retryEntriesCount * updatedCount
            hitPercentage = 100.0 / retryEntriesCount * hitCount
            missPercentage = 100.0 / retryEntriesCount * missCount
            print('R:{0} U:{1}/{2:.2f}% H:{3}/{4:.2f}% M:{5}/{6:.2f}% E:{7},{8},{9},{10} P:{11} R:{12}/s S:{13}s'.format(retryEntriesCount, updatedCount, updatedPercentage, hitCount, hitPercentage, missCount, missPercentage, timeoutErrorCount, connectionErrorCount, coordinateErrorCount, valueErrorCount, movedProxiesCount, int(updatedCount / (time.time() - startTime)), sleepTime))
            time.sleep(sleepTime)
        if hitRowsArgs:
            for rowArgs in hitRowsArgs:
                pendingRowsArgs.remove(rowArgs)
        if hitPercentage < 0.1:
            print('Hit rate dopped below one per-mille ({0}%)'.format(hitPercentage))
            print('No hits for {0} entries'.format(retryEntriesCount))
            break

db.close()
pool.close()

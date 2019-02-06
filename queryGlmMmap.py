import binascii
import requests
import struct
import sys

def queryGlmMmap(mcc, mnc, lac, cellid):
    a = '000E00000000000000000000000000001B0000000000000000000000030000'
    b = hex(cellid)[2:].zfill(8) + hex(lac)[2:].zfill(8)
    c = hex(mnc)[2:].zfill(8) + hex(mcc)[2:].zfill(8)
    string = binascii.unhexlify(a + b + c + 'FFFFFFFF00000000')

    try:
        response = requests.post('http://www.google.com/glm/mmap', string, timeout=5)
        if 25 == len(response.content):
            (a, b, errorCode, lat, lon, rng, c, d) = struct.unpack(">hBiiiiih", response.content)
            lat = lat / 1000000.0
            lon = lon / 1000000.0
            if 0 == errorCode:
                print('{0}|{1}|{2}'.format(lat, lon, rng))
            else:
                print('Error:', errorCode)
        else:
            print('No match')
    except Exception as e:
        print('Error:', e)

queryGlmMmap(int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))

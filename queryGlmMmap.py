import binascii
import requests
import sys

def queryGlmMmap(mcc, mnc, lac, cellid):
    a = '000E00000000000000000000000000001B0000000000000000000000030000'
    b = hex(cellid)[2:].zfill(8) + hex(lac)[2:].zfill(8)
    c = hex(mnc)[2:].zfill(8) + hex(mcc)[2:].zfill(8)
    string = binascii.unhexlify(a + b + c + 'FFFFFFFF00000000')

    try:
        response = requests.post('http://www.google.com/glm/mmap', string, timeout=1)
        r = binascii.hexlify(response.content)
        if 0 == int(r[6:14],16):
            print('{0}|{1}|{2}'.format(float(int(r[14:22],16))/1000000, float(int(r[22:30],16))/1000000, int(r[30:38],16)))
        else:
            print('No match')
    except Exception as e:
        print('Error:', e)

queryGlmMmap(int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))

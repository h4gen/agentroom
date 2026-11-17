"""Independent AES-GCM interop, not a second copy of the TypeScript implementation."""
import base64
import json
import sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

def decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))

def check(vector):
    event = vector['envelope']
    aad = ('agentroom/v1|event|' + vector['room_id'] + '|' + event['event_id']).encode()
    plaintext = AESGCM(decode(vector['key'])).decrypt(decode(event['nonce']), decode(event['ciphertext']), aad)
    result = json.loads(plaintext)
    assert result == vector['payload']
    return result

if '--event' in sys.argv:
    print(json.dumps(check(json.load(sys.stdin)), ensure_ascii=False))
else:
    check(json.loads(Path(__file__).with_name('aes-gcm.json').read_text()))
    print('Independent Python AES-GCM vector passed.')

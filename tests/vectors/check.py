"""Independent Python implementation of v2 AES-GCM, Ed25519 and signed metadata."""
import base64
import json
import sys
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
import hashlib

def decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))

def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')

def check(vector):
    event = vector['envelope']
    aad = ('agentroom/v2|event|' + vector['room_id'] + '|' + event['event_id']).encode()
    plaintext = AESGCM(decode(vector['key'])).decrypt(decode(event['nonce']), decode(event['ciphertext']), aad)
    result = json.loads(plaintext)
    assert result == vector['payload']
    signed = dict(result)
    signature = decode(signed.pop('signature'))
    actor = signed['actor']
    assert encode(hashlib.sha256(decode(actor['public_key'])).digest()) == actor['id']
    frame = dict(context='agentroom/signed-message/v2', room_id=vector['room_id'], event_id=event['event_id'], payload=signed)
    canonical = json.dumps(frame, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    Ed25519PublicKey.from_public_bytes(decode(actor['public_key'])).verify(signature, canonical)
    if 'blob' in vector:
        blob = vector['blob']
        ciphertext = decode(blob['ciphertext'])
        attachment = result['attachments'][0]
        aad = ('agentroom/v2|blob|' + vector['room_id'] + '|' + attachment['blob_id']).encode()
        data = AESGCM(decode(vector['key'])).decrypt(ciphertext[:12], ciphertext[12:], aad)
        assert encode(data) == blob['plaintext']
        assert len(data) == attachment['size']
        assert encode(hashlib.sha256(data).digest()) == attachment['sha256']
    return result

if '--event' in sys.argv:
    print(json.dumps(check(json.load(sys.stdin)), ensure_ascii=False))
else:
    check(json.loads(Path(__file__).with_name('aes-gcm.json').read_text()))
    print('Independent Python v2 AES-GCM, Ed25519 and attachment vectors passed.')

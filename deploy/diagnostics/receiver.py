#!/usr/bin/env python3
"""Private diagnostic receiver, Python 3.6+, no third-party dependencies or access logs."""
import json
import os
import re
import tempfile
import time
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_RAW = 1024 * 1024
MAX_WIRE = 256 * 1024
CAP = 100 * 1024 * 1024
UUID = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
KINDS = set('app-start app-ready app-quit previous-unclean main-error main-rejection window-open window-close window-unresponsive render-gone child-gone chat-open chat-start chat-send cli-spawn cli-started cli-error cli-exit pty-create pty-started pty-error pty-exit'.split())
ENUMS = {
    'processType': ['GPU', 'Utility', 'Tab', 'Browser', 'Zygote', 'Sandbox helper', 'Pepper Plugin', 'Pepper Plugin Broker'],
    'cli': ['claude', 'codex', 'omp'],
    'reason': ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction'],
    'signal': ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'error'],
    'error': ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError', 'Unknown'],
    'errorCode': ['ENOENT', 'EPIPE', 'EIO', 'EACCES', 'EPERM', 'ENOMEM', 'ENOSPC', 'EINVAL', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED']
}

def matches(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None

def validate(r):
    if not isinstance(r, dict) or set(r) != set(['schemaVersion', 'id', 'version', 'os', 'arch', 'events']): raise ValueError('schema')
    if type(r['schemaVersion']) is not int or r['schemaVersion'] != 1: raise ValueError('schema')
    if not matches(UUID, r['id']) or not matches(r'0\.4\.85-diag\.\d{1,4}', r['version']): raise ValueError('identity')
    if not matches(r'\d{1,5}(\.\d{1,5}){1,3}', r['os']) or r['arch'] not in ['x64', 'arm64', 'ia32']: raise ValueError('platform')
    if not isinstance(r['events'], list) or len(r['events']) > 1500: raise ValueError('events')
    for e in r['events']:
        if not isinstance(e, dict) or not set(['t', 'kind']).issubset(e) or not set(e).issubset(set(['t', 'kind', 'run', 'code', 'frames']) | set(ENUMS)): raise ValueError('event')
        if type(e['t']) is not int or not 0 <= e['t'] <= 10**12 or not isinstance(e['kind'], str) or e['kind'] not in KINDS: raise ValueError('event')
        if 'run' in e and not matches(UUID, e['run']): raise ValueError('run')
        if 'code' in e and (type(e['code']) is not int or abs(e['code']) > 4294967295): raise ValueError('code')
        for key, allowed in ENUMS.items():
            if key in e and e[key] not in allowed: raise ValueError('enum')
        if 'frames' in e and (not isinstance(e['frames'], list) or len(e['frames']) > 8 or any(not matches(r'(main|preload):\d{1,8}:\d{1,8}', f) for f in e['frames'])): raise ValueError('frames')
    return r

def decode_report(body):
    if len(body) > MAX_WIRE: raise ValueError('wire size')
    try:
        dec = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = dec.decompress(body, MAX_RAW + 1)
        if len(raw) > MAX_RAW or dec.unconsumed_tail or not dec.eof or dec.unused_data: raise ValueError('raw size or framing')
        return validate(json.loads(raw.decode('utf-8')))
    except (zlib.error, UnicodeError, TypeError, RecursionError) as e:
        raise ValueError('invalid report') from e

def clean(directory):
    now = time.time()
    for f in os.scandir(directory):
        if f.is_file(follow_symlinks=False) and (matches(UUID + r'\.json', f.name) or f.name.startswith('.pending-')):
            if now - f.stat().st_mtime > (14 * 86400 if f.name.endswith('.json') else 3600): os.unlink(f.path)

def store_report(directory, report, cap=CAP):
    validate(report)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    clean(directory)
    raw = json.dumps(report, sort_keys=True, separators=(',', ':')).encode('utf-8')
    if len(raw) > MAX_RAW: raise ValueError('raw size')
    dest = os.path.join(directory, report['id'] + '.json')
    if os.path.exists(dest):
        with open(dest, 'rb') as f:
            if f.read(MAX_RAW + 1) != raw: raise FileExistsError('id conflict')
        return report['id']
    total = sum(f.stat().st_size for f in os.scandir(directory) if f.is_file(follow_symlinks=False))
    if total + len(raw) > cap: raise OverflowError('capacity')
    fd, tmp = tempfile.mkstemp(prefix='.pending-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, dest)
        dfd = os.open(directory, os.O_RDONLY)
        try: os.fsync(dfd)
        finally: os.close(dfd)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    return report['id']

class Handler(BaseHTTPRequestHandler):
    server_version = 'Diagnostics'
    def log_message(self, *args): pass
    def setup(self):
        super().setup(); self.connection.settimeout(10)
    def reply(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.send_header('Connection', 'close')
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        self.reply(200 if self.path == '/health' else 404, {'ok': self.path == '/health'})
    def do_POST(self):
        if self.path != '/diagnostics/v1/reports': self.reply(404, {'ok': False}); return
        if self.headers.get('Content-Encoding') != 'gzip' or self.headers.get('Content-Type') != 'application/json' or self.headers.get('Transfer-Encoding'):
            self.reply(415, {'ok': False}); return
        try:
            length = int(self.headers.get('Content-Length', '-1'))
            if length <= 0 or length > MAX_WIRE: self.reply(413, {'ok': False}); return
            body = self.rfile.read(length)
            if len(body) != length: raise ValueError('truncated')
            r = decode_report(body)
            ident = store_report(self.server.directory, r)
            self.reply(201, {'ok': True, 'id': ident})
        except FileExistsError: self.reply(409, {'ok': False})
        except OverflowError: self.reply(507, {'ok': False})
        except (ValueError, TypeError, KeyError): self.reply(400, {'ok': False})
        except OSError: self.reply(503, {'ok': False})

def serve(directory, port):
    os.umask(0o077)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    clean(directory)
    server = HTTPServer(('127.0.0.1', port), Handler)  # single writer, bounded concurrency
    server.directory = directory
    server.timeout = 60
    while True:
        server.handle_request()
        clean(directory)

if __name__ == '__main__':
    serve(os.environ.get('EAS_DIAGNOSTIC_DIR', '/var/lib/eas-diagnostics'), int(os.environ.get('EAS_DIAGNOSTIC_PORT', '4187')))

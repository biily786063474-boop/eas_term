import gzip
import json
import os
import tempfile
import unittest
import uuid
from receiver import decode_report, store_report, clean, MAX_RAW

def report():
    return dict(schemaVersion=1, id=str(uuid.uuid4()), version='0.4.85-diag.1', os='10.0.22631', arch='x64', events=[dict(t=0, kind='app-start')])

def pack(r):
    return gzip.compress(json.dumps(r).encode())

class ReceiverTest(unittest.TestCase):
    def test_validate(self):
        r = report()
        self.assertEqual(decode_report(pack(r)), r)
        for field, value in [('message', 'secret'), ('version', 'secret'), ('id', '../../bad')]:
            bad = dict(r); bad[field] = value
            with self.assertRaises(ValueError): decode_report(pack(bad))
        r['events'][0]['message'] = 'private'
        with self.assertRaises(ValueError): decode_report(pack(r))
    def test_limits(self):
        with self.assertRaises(ValueError): decode_report(gzip.compress(b' ' * (MAX_RAW + 1)))
        with self.assertRaises(ValueError): decode_report(b'x' * (256 * 1024 + 1))
        with self.assertRaises(ValueError): decode_report(b'garbage')
        with self.assertRaises(ValueError): decode_report(pack(report()) + pack(report()))
    def test_store_idempotence_permissions_cap_retention(self):
        with tempfile.TemporaryDirectory() as d:
            r = report(); self.assertEqual(store_report(d, r), r['id'])
            self.assertEqual(store_report(d, r), r['id'])
            p = os.path.join(d, r['id'] + '.json')
            self.assertEqual(os.stat(p).st_mode & 0o777, 0o600)
            bad = dict(r); bad['os'] = '0.0'
            with self.assertRaises(FileExistsError): store_report(d, bad)
            with self.assertRaises(OverflowError): store_report(d, report(), cap=10)
            os.utime(p, (1, 1)); clean(d)
            self.assertFalse(os.path.exists(p))
    def test_nested_schema_types(self):
        for event in [dict(t=True, kind='app-start'), dict(t=0, kind='secret'), dict(t=0, kind='cli-error', error='secret'), dict(t=0, kind='main-error', frames=['C:\\Users\\private'])]:
            r = report(); r['events'] = [event]
            with self.assertRaises(ValueError): decode_report(pack(r))

if __name__ == '__main__': unittest.main()

class HttpTest(unittest.TestCase):
    def test_actual_http_receipt_and_conflict(self):
        import threading
        from http.server import HTTPServer
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        from receiver import Handler
        with tempfile.TemporaryDirectory() as d:
            server = HTTPServer(('127.0.0.1', 0), Handler); server.directory = d
            thread = threading.Thread(target=server.serve_forever); thread.start()
            url = 'http://127.0.0.1:%d/diagnostics/v1/reports' % server.server_port
            r = report()
            def post(value): return urlopen(Request(url, data=pack(value), headers={'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}), timeout=3)
            try:
                with post(r) as response: self.assertEqual(json.loads(response.read())['id'], r['id'])
                with post(r) as response: self.assertEqual(response.status, 201)
                r['os'] = '0.0'
                with self.assertRaises(HTTPError) as err: post(r)
                self.assertEqual(err.exception.code, 409)
            finally: server.shutdown(); thread.join(); server.server_close()

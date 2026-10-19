import json
import os
from pathlib import Path
import select
import signal
import socket
import socketserver
import subprocess
import sys
import time


if sys.argv[1] == '--serve':
    control, port, remote_port = sys.argv[2:]

    class Forward(socketserver.BaseRequestHandler):
        def handle(self):
            try:
                with socket.create_connection(('127.0.0.1', int(remote_port))) as remote:
                    while True:
                        ready, _, _ = select.select([self.request, remote], [], [], 3)
                        for source in ready:
                            data = source.recv(65536)
                            if not data:
                                return
                            (remote if source is self.request else self.request).sendall(data)
            except OSError:
                return

    class Server(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = True

    with Server(('127.0.0.1', int(port)), Forward) as server:
        Path(control).write_text(json.dumps({'pid': os.getpid()}))
        server.serve_forever()
else:
    args = sys.argv[1:]
    if args[0] == '-G':
        print('hostname ' + os.environ.get('MQ_TEST_SSH_HOST', 'original-host'))
        print('user isolated\nport 22')
        sys.exit(0)
    control = Path(args[args.index('-S') + 1])
    if '-O' in args:
        try:
            pid = json.loads(control.read_text())['pid']
            os.kill(pid, 0)
            if args[args.index('-O') + 1] == 'exit':
                os.kill(pid, signal.SIGTERM)
                control.unlink()
            else:
                print(f'Master running (pid={pid})', file=sys.stderr)
        except (OSError, ValueError):
            sys.exit(1)
    else:
        _, port, _, remote = args[args.index('-L') + 1].split(':')
        subprocess.Popen([sys.executable, __file__, '--serve', str(control), port, remote],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            if control.exists():
                break
            time.sleep(.01)
        else:
            sys.exit(1)

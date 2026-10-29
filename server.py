#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
3D 照片墙 · 本地服务
------------------------------------------------------------
作用：
1. 把整个目录当静态网站提供（浏览器能读本地文件）
2. /api/manifest  自动扫描 media/ 与 photos/ 目录，
   把里面所有图片和视频随机排序后返回给网页
3. 支持 Range 请求（视频才能拖动进度条、边下边播）

用法：双击 「启动.bat」，或命令行 python server.py
"""

import http.server
import json
import mimetypes
import os
import random
import re
import socketserver
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
MEDIA_DIRS = ["media", "photos"]
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".jfif"}
VID_EXT = {".mp4", ".webm", ".mov", ".m4v", ".ogv", ".ogg"}
SKIP_DIRS = {"vendor", "__pycache__", ".git"}


def scan_media():
    items = []
    for d in MEDIA_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if not x.startswith(".") and x not in SKIP_DIRS]
            for name in filenames:
                if name.startswith("."):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext in IMG_EXT:
                    kind = "image"
                elif ext in VID_EXT:
                    kind = "video"
                else:
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                try:
                    size = os.path.getsize(full)
                except OSError:
                    size = 0
                items.append({
                    "type": kind,
                    "src": urllib.parse.quote(rel),
                    "name": name,
                    "size": size,
                })
    random.shuffle(items)
    return items


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "PhotoWall/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        # 只在终端显示错误，避免刷屏
        if args and str(args[0]).startswith(("4", "5")):
            sys.stderr.write("  [!] %s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path in ("/api/manifest", "/api/manifest.json"):
            return self.send_manifest()
        full = os.path.join(ROOT, path.lstrip("/"))
        if os.path.isfile(full) and self.serve_range(full):
            return
        return super().do_GET()

    def send_manifest(self):
        items = scan_media()
        body = json.dumps(
            {"items": items, "count": len(items), "ts": int(time.time())},
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def serve_range(self, full):
        rng = self.headers.get("Range")
        if not rng:
            return False
        m = re.match(r"bytes=(\d*)-(\d*)", rng.strip())
        if not m:
            return False
        size = os.path.getsize(full)
        if size == 0:
            return False
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return True
        try:
            with open(full, "rb") as f:
                f.seek(start)
                data = f.read(end - start + 1)
        except OSError:
            return False
        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True


def port_in_use(port):
    import socket
    s = socket.socket()
    s.settimeout(0.4)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def is_our_server(port):
    """端口被占了：看看是不是上一次没关掉的本服务，是的话直接复用。"""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/manifest" % port, timeout=1.2) as r:
            return "PhotoWall" in (r.headers.get("Server") or "")
    except Exception:
        return False


def main():
    argv = [a for a in sys.argv[1:]]
    auto_open = "--no-open" not in argv
    argv = [a for a in argv if not a.startswith("--")]
    want = int(argv[0]) if argv else 8765

    httpd = None
    port = want
    for p in range(want, want + 20):
        if port_in_use(p):
            if is_our_server(p):
                url = "http://127.0.0.1:%d/" % p
                print("  服务本来就在运行：%s" % url, flush=True)
                print("  （已帮你把浏览器打开，这个窗口可以直接关掉）", flush=True)
                if auto_open:
                    webbrowser.open(url)
                return
            continue
        try:
            httpd = socketserver.ThreadingTCPServer(("127.0.0.1", p), Handler)
            httpd.daemon_threads = True
            port = p
            break
        except OSError:
            continue

    if httpd is None:
        print("  [!] 8765 之后的端口都被占用了，请关掉一些程序再试。", flush=True)
        return

    url = "http://127.0.0.1:%d/" % port
    n = len(scan_media())

    print("", flush=True)
    print("  ==========================================================", flush=True)
    print("   3D 照片墙 · 本地服务已启动", flush=True)
    print("  ==========================================================", flush=True)
    print("   地址: %s" % url, flush=True)
    print("   媒体目录: media/   （当前 %d 个文件，增删后刷新页面即生效）" % n, flush=True)
    print("", flush=True)
    print("   浏览器没自动打开的话，手动复制上面这个地址到浏览器。", flush=True)
    print("   ★ 这个窗口别关，关掉 = 停止服务。", flush=True)
    print("  ==========================================================", flush=True)
    print("", flush=True)

    if auto_open:
        # 服务已经在监听了，再开浏览器就绝不会白屏
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("  已停止", flush=True)


if __name__ == "__main__":
    main()


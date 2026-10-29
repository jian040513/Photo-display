/* ============================================================
   手势控制模块（本地 MediaPipe HandLandmarker，不联网）
   ------------------------------------------------------------
   注意：这里故意写成「普通脚本 + 动态 import」，不用 <script type="module">。
   原因：module 的静态 import 一旦失败（比如直接双击 index.html 打开、
   浏览器拦掉 file:// 的模块加载），整个文件都不会执行，
   window.__Gesture 就不存在，界面只会一直卡在「手势模块还在加载」。
   改成普通脚本后，入口先注册好，MediaPipe 等到真正开摄像头时再加载，
   出错也能给出具体原因。
   ============================================================ */
(function () {
  'use strict';

  var CONN = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [17, 18], [18, 19], [19, 20],
    [0, 17]
  ];

  var handState = {
    status: 'idle',   // idle | loading | ready | denied | unsupported | error | nomodule
    error: '',
    present: false,
    x: 0.5,
    y: 0.5,
    pinch: 0,
    open: 0,
    hands: 0,
    spread: 0,
    fistHold: 0,
    fps: 0,
    mirror: true
  };
  window.__handState = handState;

  var video = null, overlay = null, octx = null;
  var landmarker = null, stream = null;
  var running = false, rafId = 0, lastVideoTime = -1;
  var fistHold = 0, openHold = 0, pinchDown = false, pinchLast = 0, lastGesture = 0, lostT = 0;
  var frames = 0, fpsT = 0, simTimer = 0;
  var raw = { x: 0.5, y: 0.5, pinch: 0, open: 0, spread: 0 };

  var BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[^/]*$/, '');
    return location.href.replace(/[^/]*$/, '');
  })();

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)); }
  function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /* ---------- MediaPipe 懒加载 ---------- */
  var mpPromise = null;
  function loadMP() {
    if (!mpPromise) {
      mpPromise = import(BASE + 'vendor/mp/vision_bundle.mjs').catch(function (e) {
        mpPromise = null;
        throw e;
      });
    }
    return mpPromise;
  }

  /* ---------- 摄像头预览上的骨架 ---------- */
  function sizeOverlay() {
    if (!overlay || !video) return;
    var r = video.getBoundingClientRect();
    var w = Math.max(2, Math.round(r.width));
    var h = Math.max(2, Math.round(r.height));
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  }

  function drawOverlay(landmarks) {
    if (!octx) return;
    var w = overlay.width, h = overlay.height;
    octx.clearRect(0, 0, w, h);
    if (!landmarks || !landmarks.length) return;
    octx.lineWidth = 3;
    octx.lineCap = 'round';
    var pinching = handState.pinch > 0.5;
    landmarks.forEach(function (lms, hi) {
      var color = hi === 0 ? (pinching ? '#ffd08a' : '#7fe0c8') : '#9bb8ff';
      octx.strokeStyle = color;
      octx.shadowColor = color;
      octx.shadowBlur = 10;
      octx.beginPath();
      for (var k = 0; k < CONN.length; k++) {
        var a = CONN[k][0], b = CONN[k][1];
        octx.moveTo(lms[a].x * w, lms[a].y * h);
        octx.lineTo(lms[b].x * w, lms[b].y * h);
      }
      octx.stroke();
      octx.shadowBlur = 0;
      [0, 4, 8, 12, 16, 20].forEach(function (i) {
        octx.fillStyle = '#fff';
        octx.beginPath();
        octx.arc(lms[i].x * w, lms[i].y * h, i === 4 || i === 8 ? 4.2 : 2.6, 0, Math.PI * 2);
        octx.fill();
      });
      if (pinching && hi === 0) {
        octx.strokeStyle = 'rgba(255,208,138,.95)';
        octx.lineWidth = 2.5;
        octx.beginPath();
        octx.moveTo(lms[4].x * w, lms[4].y * h);
        octx.lineTo(lms[8].x * w, lms[8].y * h);
        octx.stroke();
        octx.lineWidth = 3;
      }
    });
  }

  /* ---------- 纯函数：21 点 → 捏合 / 张开 / 掌心 ---------- */
  function measure(lms) {
    var palm = [0, 5, 9, 13, 17].reduce(function (a, i) {
      return { x: a.x + lms[i].x / 5, y: a.y + lms[i].y / 5 };
    }, { x: 0, y: 0 });
    var ref = Math.max(0.02, dist(lms[0], lms[9])); // 掌长，做尺度归一

    var ratio = dist(lms[4], lms[8]) / ref;                 // 拇指尖 ↔ 食指尖
    var pinch = clamp(1 - (ratio - 0.30) / (1.05 - 0.30), 0, 1);

    var openRaw = (
      dist(lms[8], lms[0]) + dist(lms[12], lms[0]) +
      dist(lms[16], lms[0]) + dist(lms[20], lms[0])
    ) / 4 / ref;
    var open = clamp((openRaw - 1.02) / (2.15 - 1.02), 0, 1);

    return { x: handState.mirror ? 1 - palm.x : palm.x, y: palm.y, pinch: pinch, open: open, palm: palm };
  }

  function analyze(landmarks) {
    var main = 0;
    for (var i = 1; i < landmarks.length; i++) {
      if (landmarks[i][0].z < landmarks[main][0].z) main = i;
    }
    var m = measure(landmarks[main]);
    raw.x = m.x; raw.y = m.y; raw.pinch = m.pinch; raw.open = m.open;

    if (landmarks.length > 1) {
      var a = landmarks[0], b = landmarks[1];
      var pa = [0, 5, 9, 13, 17].reduce(function (o, i) { return { x: o.x + a[i].x / 5, y: o.y + a[i].y / 5 }; }, { x: 0, y: 0 });
      var pb = [0, 5, 9, 13, 17].reduce(function (o, i) { return { x: o.x + b[i].x / 5, y: o.y + b[i].y / 5 }; }, { x: 0, y: 0 });
      raw.spread = dist2(pa, pb) * 2.2;
    } else {
      raw.spread = handState.spread * 0.9;
    }
    handState.hands = landmarks.length;
  }

  function smoothing(dt) {
    handState.x += (raw.x - handState.x) * Math.min(1, dt * 11);
    handState.y += (raw.y - handState.y) * Math.min(1, dt * 11);
    handState.pinch += (raw.pinch - handState.pinch) * Math.min(1, dt * 14);
    handState.open += (raw.open - handState.open) * Math.min(1, dt * 10);
    handState.spread += (raw.spread - handState.spread) * Math.min(1, dt * 8);
  }

  function emitGesture(name) {
    window.dispatchEvent(new CustomEvent(name));
  }

  /** 平滑 + 手势判定：摄像头模式和模拟模式共用，便于离线测试 */
  function step(dt, now) {
    smoothing(dt);

    if (handState.present) {
      if (handState.open < 0.30) fistHold += dt; else fistHold = 0;
      if (handState.open > 0.72) openHold += dt; else openHold = 0;

      if (fistHold > 0.28 && now - lastGesture > 900) {
        lastGesture = now; fistHold = 0; emitGesture('gesture:fist');
      }
      if (openHold > 0.28 && now - lastGesture > 900) {
        lastGesture = now; openHold = 0; emitGesture('gesture:open');
      }

      // 捏合按「按住」处理：捏住的一瞬间发 pinch-start，松开手指发 pinch-end。
      // 这样页面就能实现「按住看大图、松手关掉」。
      // 用 open 把捏合和握拳分开：捏合时其余手指是舒展的，握拳时是蜷起来的。
      lostT = 0;
      if (!pinchDown && handState.pinch > 0.68 && handState.open > 0.34 && now - pinchLast > 320) {
        pinchDown = true;
        pinchLast = now;
        emitGesture('gesture:pinch-start');
      } else if (pinchDown && handState.pinch < 0.38) {
        pinchDown = false;
        emitGesture('gesture:pinch-end');
      }
    } else {
      fistHold = 0; openHold = 0;
      // 手从画面里拿走了，也要把图收起来，不然会一直挂着。
      // 留 0.35s 缓冲：识别偶尔丢一两帧不应该让图片闪一下。
      lostT += dt;
      if (pinchDown && lostT > 0.35) { pinchDown = false; emitGesture('gesture:pinch-end'); }
    }

    handState.fistHold = fistHold;
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (!video || video.readyState < 2) return;

    var now = performance.now();
    if (video.currentTime === lastVideoTime) { renderOnly(); return; }
    lastVideoTime = video.currentTime;
    sizeOverlay();

    var res = null;
    try {
      res = landmarker.detectForVideo(video, now);
    } catch (err) {
      handState.error = String((err && err.message) || err);
      return;
    }

    var dt = Math.min(0.1, (now - (loop.last || now)) / 1000) || 0.016;
    loop.last = now;

    if (res && res.landmarks && res.landmarks.length) {
      handState.present = true;
      analyze(res.landmarks);
      drawOverlay(res.landmarks);
    } else {
      handState.present = false;
      handState.hands = 0;
      drawOverlay(null);
      raw.pinch = Math.max(0, raw.pinch - 0.08);
      raw.open = Math.max(0, raw.open - 0.05);
    }

    if (handState.sim) {
      var sim = handState.sim;
      handState.present = true;
      handState.hands = 1;
      raw.x = sim.x; raw.y = sim.y; raw.pinch = sim.pinch; raw.open = sim.open;
    }

    step(dt, now);

    frames++;
    if (now - fpsT > 700) {
      handState.fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0; fpsT = now;
    }
  }

  function renderOnly() {
    if (!handState.present) drawOverlay(null);
  }

  /* ---------- 启动 / 停止 ---------- */
  async function startHand(videoEl, canvasEl) {
    video = videoEl;
    overlay = canvasEl;
    octx = overlay.getContext('2d');
    handState.status = 'loading';
    handState.error = '';

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        var e0 = new Error('这个地址不给摄像头权限（需要 http://localhost 或 https）');
        e0.name = 'NotSupportedError';
        throw e0;
      }
      // 先开摄像头，让画面尽快出来
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false
      });
      video.srcObject = stream;
      try { await video.play(); } catch (err) { /* 某些浏览器要用户手势，忽略 */ }

      var mod = await loadMP();
      var fileset = await mod.FilesetResolver.forVisionTasks(BASE + 'vendor/mp/wasm/');
      var opts = function (delegate) {
        return {
          baseOptions: { modelAssetPath: BASE + 'vendor/mp/hand_landmarker.task', delegate: delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        };
      };
      try {
        landmarker = await mod.HandLandmarker.createFromOptions(fileset, opts('GPU'));
      } catch (e1) {
        landmarker = await mod.HandLandmarker.createFromOptions(fileset, opts('CPU'));
      }

      running = true;
      handState.status = 'ready';
      loop();
      return true;
    } catch (err) {
      var name = (err && err.name) || '';
      handState.status = (name === 'NotAllowedError' || name === 'PermissionDeniedError') ? 'denied' : 'error';
      handState.error = String((err && err.message) || err);
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
      return false;
    }
  }

  function stopHand() {
    running = false;
    cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    if (video) video.srcObject = null;
    handState.status = 'idle';
    handState.present = false;
    handState.pinch = 0;
    drawOverlay(null);
  }

  window.__Gesture = {
    start: startHand,
    stop: stopHand,
    state: handState,
    get pinching() { return pinchDown; },
    measure: measure,
    analyze: analyze,
    /** 无摄像头也能演示 / 自测：__Gesture.simulate(0.5, 0.5, 0.9, 0.2) */
    simulate: function (x, y, pinch, open) {
      if (x === null) {
        handState.sim = null;
        handState.present = false;
        return;
      }
      handState.sim = { x: x, y: y, pinch: pinch, open: open };
      handState.present = true;
      if (!simTimer) {
        var t0 = performance.now(), last = t0;
        simTimer = setInterval(function () {
          if (!handState.sim) { clearInterval(simTimer); simTimer = 0; return; }
          var now = performance.now();
          var dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          var s2 = handState.sim;
          raw.x = s2.x; raw.y = s2.y; raw.pinch = s2.pinch; raw.open = s2.open;
          step(dt, now);
        }, 33);
      }
    }
  };

  window.dispatchEvent(new CustomEvent('hand:module-ready'));
})();

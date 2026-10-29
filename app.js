/* ============================================================
   3D 照片墙 · 送给亲爱的你
   ------------------------------------------------------------
   画面由两层组成（对齐参考视频的做法）：

   ① 粒子云：几千颗发光的小爱心
      聚合 → 拼成心形 / 拼成你输入的文字（2026）
      散开 → 铺满整个屏幕，变成「满天星」
   ② 照片卡：少量真实的照片 / 视频封面
      沿着绕心的轨道慢慢转，一会儿在前面、一会儿转到背面

   手势：握拳聚合 / 张手散开 / 捏住看大图（松手关闭）/ 手掌平移转动
   媒体：自动读取 media 目录，图片和视频都可以，数量不限
   ============================================================ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const TAU = Math.PI * 2;

  /* ---------------- 配置 ---------------- */
  const CFG_KEY = 'photowall.v4';
  const DEFAULTS = {
    title: '2026 Happy New Year',
    sub: '送给亲爱的你',
    showSub: true,
    shape: 'heart',      // heart | text
    gatherText: '2026',
    vol: 55,
    mirror: true,
    speed: 100,
    cam: 100,
    fog: 100,
    stars: 100,
    cards: 20,        // 场景里同时展示的照片 / 视频张数
  };
  const CFG = Object.assign({}, DEFAULTS);
  try { Object.assign(CFG, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { /* ignore */ }
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); } catch (e) { /* ignore */ } };

  const isMobile = () => window.innerWidth < 760;

  /* ---------------- 渲染器 ---------------- */
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // 上限 1.75：再往上只是白白拖慢帧率，光斑本来就是糊的，肉眼看不出差别
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050a);

  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(0, 0, 60);

  /** 所有会转动的东西都挂在这个 group 上，转它比逐点算旋转便宜得多 */
  const world = new THREE.Group();
  scene.add(world);

  const geoPlane = new THREE.PlaneGeometry(1, 1);

  /* ---------------- 通用工具 ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 近似高斯：三次均匀相加再归一
  const gauss = (rnd) => (rnd() + rnd() + rnd() - 1.5) / 1.5;

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawCover(g, img, x, y, w, h) {
    const iw = img.width || img.videoWidth || 1;
    const ih = img.height || img.videoHeight || 1;
    const s = Math.max(w / iw, h / ih);
    g.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
  }

  /* ---------------- 心形背后的一团红雾（光晕） ---------------- */
  const glowTex = (function () {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0.00, 'rgba(255,58,72,.60)');
    rg.addColorStop(0.30, 'rgba(226,22,48,.32)');
    rg.addColorStop(0.62, 'rgba(150,8,30,.12)');
    rg.addColorStop(1.00, 'rgba(110,0,18,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();

  /* ---------------- 照片卡贴图（白边拍立得） ---------------- */
  function makeCardTexture(img, size, isVideo) {
    const S = size;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');

    const pad = Math.round(S * 0.048);
    const inner = S - pad * 2;

    g.save();
    g.shadowColor = 'rgba(0,0,0,.55)';
    g.shadowBlur = S * 0.06;
    g.shadowOffsetY = S * 0.016;
    g.fillStyle = '#fbf8f2';
    roundRect(g, pad * 0.52, pad * 0.52, S - pad * 1.04, S - pad * 1.04, S * 0.035);
    g.fill();
    g.restore();

    g.save();
    roundRect(g, pad, pad, inner, inner, S * 0.02);
    g.clip();
    try { drawCover(g, img, pad, pad, inner, inner); } catch (e) {
      g.fillStyle = '#2a2d36'; g.fillRect(pad, pad, inner, inner);
    }
    g.fillStyle = 'rgba(255,238,224,.045)';
    g.fillRect(pad, pad, inner, inner);
    g.restore();

    if (isVideo) {
      const r = S * 0.095;
      const cx = pad + r * 1.5, cy = pad + inner - r * 1.5;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fill();
      g.beginPath();
      g.moveTo(cx - r * 0.22, cy - r * 0.4);
      g.lineTo(cx + r * 0.44, cy);
      g.lineTo(cx - r * 0.22, cy + r * 0.4);
      g.closePath();
      g.fillStyle = '#fff';
      g.fill();
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  /* ---------------- 背景星点 ---------------- */
  const sky = { stars: null };
  function buildSky() {
    const rnd = mulberry32(2026);
    const n1 = 900;
    const p1 = new Float32Array(n1 * 3);
    const c1 = new Float32Array(n1 * 3);
    for (let i = 0; i < n1; i++) {
      const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u);
      const R = 120 + rnd() * 150;
      p1[i * 3] = Math.cos(th) * s * R;
      p1[i * 3 + 1] = u * R * 0.9;
      p1[i * 3 + 2] = Math.sin(th) * s * R - 40;
      const w = 0.35 + rnd() * 0.5;
      c1[i * 3] = w; c1[i * 3 + 1] = w * 0.97; c1[i * 3 + 2] = w * 0.9;
    }
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(p1, 3));
    g1.setAttribute('color', new THREE.BufferAttribute(c1, 3));

    const dot = (function () {
      const S = 64;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const g = cv.getContext('2d');
      const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.3, 'rgba(255,255,255,.5)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, S, S);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    sky.stars = new THREE.Points(g1, new THREE.PointsMaterial({
      size: 1.1, map: dot, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      opacity: 0.9, fog: false,
    }));
    scene.add(sky.stars);
    applyStars();
  }
  function applyStars() {
    if (sky.stars) sky.stars.material.opacity = 0.1 + 0.8 * (CFG.stars / 100);
  }

  /* ---------------- 心形几何 ---------------- */
  const HEART_W = 26; // 心形目标宽度（世界单位）

  function heartPoint(a) {
    return {
      x: 16 * Math.pow(Math.sin(a), 3),
      y: 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a),
    };
  }

  /** 把心形曲线画成实心区域，再按像素均匀采样。
      同时算一张「离轮廓有多远」的距离图 —— 这是心形能「饱满」的关键：
      离轮廓越远越厚、贴着轮廓越薄，于是前后都鼓起来，像一只吹起来的心形气球。
      （之前直接用椭球公式算厚度，背面几乎是平的，一转过去就露馅。） */
  const HEART = (function () {
    const S = 384;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');

    // 曲线 → 多边形，先缩放到画布内
    const raw = [];
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 480; i++) {
      const p = heartPoint((i / 480) * TAU);
      raw.push(p);
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = S * 0.03;
    const sc = Math.min((S - pad * 2) / (maxX - minX), (S - pad * 2) / (maxY - minY));
    const ox = S / 2 - ((minX + maxX) / 2) * sc;
    const oy = S / 2 + ((minY + maxY) / 2) * sc;

    g.beginPath();
    raw.forEach((p, i) => {
      const x = ox + p.x * sc;
      const y = oy - p.y * sc;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();

    const data = g.getImageData(0, 0, S, S).data;

    /* ---- 距离变换（两遍 chamfer，3/4.243 近似欧氏距离） ---- */
    const BIG = 1e6, D1 = 3, D2 = 4.243;
    const dist = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) dist[i] = data[i * 4 + 3] > 140 ? BIG : 0;
    for (let y = 1; y < S - 1; y++) {
      const row = y * S;
      for (let x = 1; x < S - 1; x++) {
        const idx = row + x;
        if (dist[idx] === 0) continue;
        let m = dist[idx];
        m = Math.min(m, dist[idx - 1] + D1, dist[idx - S] + D1);
        m = Math.min(m, dist[idx - S - 1] + D2, dist[idx - S + 1] + D2);
        dist[idx] = m;
      }
    }
    for (let y = S - 2; y > 0; y--) {
      const row = y * S;
      for (let x = S - 2; x > 0; x--) {
        const idx = row + x;
        if (dist[idx] === 0) continue;
        let m = dist[idx];
        m = Math.min(m, dist[idx + 1] + D1, dist[idx + S] + D1);
        m = Math.min(m, dist[idx + S + 1] + D2, dist[idx + S - 1] + D2);
        dist[idx] = m;
      }
    }

    /* ---- 采样：每颗粒子带一个「厚薄系数」 dn（0=轮廓边，1=最厚处） ---- */
    const pts = [];
    let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9, maxD = 1;
    for (let y = 0; y < S; y += 2) {
      for (let x = 0; x < S; x += 2) {
        const dv = dist[y * S + x];
        if (dv <= 0 || dv >= BIG) continue;
        const dp = dv / D1;
        if (dp > maxD) maxD = dp;
        pts.push([x, y, dp]);
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
    for (let i = 0; i < pts.length; i++) {
      pts[i][2] = Math.min(1, pts[i][2] / (maxD * 0.92));
    }

    const cx = (bx0 + bx1) / 2;
    const cy = (by0 + by1) / 2;
    const k = HEART_W / ((bx1 - bx0) || 1);   // 像素 → 世界单位
    return {
      pts,
      cx, cy, k,
      halfW: HEART_W / 2,
      halfH: ((by1 - by0) * k) / 2,
    };
  })();

  /* ---------------- 文字取点 ---------------- */
  let textCache = { key: '', pts: null };
  function sampleTextPts(str) {
    const key = str + '|' + document.fonts.status;
    if (textCache.key === key && textCache.pts) return textCache.pts;
    const W = 720, H = 240;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const family = 'Georgia, "Times New Roman", "Songti SC", "Noto Serif SC", serif';
    let fs = 180;
    g.font = 'bold ' + fs + 'px ' + family;
    let guard = 0;
    while (g.measureText(str).width > W * 0.92 && fs > 26 && guard++ < 45) {
      fs -= 8;
      g.font = 'bold ' + fs + 'px ' + family;
    }
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(str, W / 2, H / 2);
    const data = g.getImageData(0, 0, W, H).data;
    const pts = [];
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (data[(y * W + x) * 4 + 3] > 128) pts.push([x, y]);
      }
    }
    textCache = { key, pts };
    return pts;
  }

  const TEXT = { halfW: 13, halfH: 6, box: null };
  function measureText(str) {
    const pts = sampleTextPts(str);
    if (!pts.length) return null;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const s = HEART_W / ((maxX - minX) || 1);
    TEXT.box = { cx, cy, s };
    TEXT.halfW = HEART_W / 2;
    TEXT.halfH = ((maxY - minY) * s) / 2;
    return TEXT.box;
  }

  /* ============================================================
     ① 粒子云
     ============================================================ */
  const P = {
    n: 0,
    points: null,
    cur: null,
    tgt: null,
    nrm: null,
    base: null,
    sizeArr: null,
    sizeAttr: null,
    geo: null,
    posAttr: null,
    mat: null,
    delay: null,
    glow: null,
    glowT: 0,
    built: false,
  };

  // 聚合时只画前 N 颗（每颗都看得清）；散开时把整池都撒出去填满背景
  const PARTICLE_N = () => (isMobile() ? 1800 : 3000);
  const PARTICLE_MAX = () => (isMobile() ? 2100 : 3000);

  // 心形的最大半厚度。这个值直接决定「饱满」到什么程度：
  // 太小 → 一片剪影；太大 → 一颗球。6.4 差不多是一只吹起来的心形气球。
  const H_DEPTH = 6.4;

  // 视角相关的表现参数（聚合 / 散开两套），切换时平滑过渡
  const LOOK = { mix: 0, soft: 0.04, alpha: 0 };
  const LOOK_T = { mix: 0, soft: 0.04, alpha: 0 };

  // 散开时按三档分配，粒子的「尺寸」和「深度」用同一个档，两者才对得上
  const TIER_DUST = 90, TIER_MID = 98.5;

  const P_VERT = `
    attribute float aSize;
    attribute float aSct;
    attribute vec3 aColor;
    attribute vec3 aNrm;
    attribute float aSeed;
    attribute float aSoft;
    attribute float aAlpha;
    attribute float aSctA;

    uniform float uProj;
    uniform float uTime;
    uniform float uDrift;
    uniform float uMix;
    uniform float uSoftBias;
    uniform float uD0;
    uniform float uD1;
    uniform float uBeat;

    varying vec3 vColor;
    varying float vSoft;
    varying float vAlpha;
    varying float vSpec;

    void main() {
      float s = aSeed * 6.2831853;
      vec3 p = position;
      p.x += sin(uTime * 0.80 + s) * uDrift;
      p.y += cos(uTime * 0.63 + s * 1.7) * uDrift;
      p.z += sin(uTime * 0.51 + s * 2.3) * uDrift;

      // 心跳：整颗心轻轻收一下再弹回来，只在聚合时
      float beat = pow(0.5 + 0.5 * sin(uTime * 4.4), 6.0);
      p.xy *= 1.0 + beat * uBeat;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float d = max(0.8, -mv.z);
      float tw = 0.91 + 0.09 * sin(uTime * 1.6 + s * 2.7);

      // 视空间方向光（左上偏前）。用真法线算，转动时光影跟着走 ——
      // 这一步才让珠子从「一堆平的圆点」变成一堆真的球。
      vec3 n = normalize(normalMatrix * aNrm);
      vec3 L = normalize(vec3(-0.46, 0.52, 0.72));
      float lam = clamp(dot(n, L), 0.0, 1.0);
      float lit = mix(0.56, 1.36, pow(lam, 0.78));

      // 空气透视：近处亮、远处暗
      float k = clamp((d - uD0) / max(1.0, uD1 - uD0), 0.0, 1.0);
      vColor = aColor * mix(1.10, 0.60, k) * mix(lit, 1.0, uMix);
      vSpec = pow(lam, 5.0) * (1.0 - uMix);

      // 聚合用「珠子尺寸」，散开用「光斑尺寸」，中间平滑插值
      float sz = clamp(mix(aSize, aSct, uMix) * uProj / d, 1.4, 200.0);
      gl_PointSize = sz;

      // 越大的点越虚：镜头景深没对上，大光斑自然会糊
      // 聚合时几乎不虚（珠子要清亮），散开时按档位决定虚实：
      // 远处碎屑保持锐利的小火星，只有中景/贴脸的才化开成光斑
      vSoft = clamp(aSoft * mix(0.18, 1.0, uMix) + uSoftBias + smoothstep(64.0, 210.0, sz) * 0.34, 0.0, 1.0);
      // 散开时用另一套透明度：远景碎屑必须很淡，否则整屏就是一堵红墙
      vAlpha = mix(aAlpha, aSctA, uMix) * tw;

      gl_Position = projectionMatrix * mv;
    }
  `;

  // 不用贴图，直接在片元里画：
  //   聚合 = 一颗球（球面明暗 + 左上高光 + 边缘压暗）
  //   散开 = 一枚柔光斑（中间淡、边缘略亮的那圈）
  const P_FRAG = `
    precision highp float;
    varying vec3 vColor;
    varying float vSoft;
    varying float vAlpha;
    varying float vSpec;

    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d = length(p);
      if (d > 1.0) discard;
      float t = clamp(d, 0.0, 1.0);

      // ---------- ① 玻璃珠：一个真正的球，而不是一个红色圆片 ----------
      float z = sqrt(max(0.0, 1.0 - t * t));
      vec3 n = vec3(p.x, p.y, z);
      // 主光在左上稍偏前（屏幕坐标 y 朝下，所以光的 y 取负）
      vec3 L = normalize(vec3(-0.40, -0.46, 0.79));
      float diff = clamp(dot(n, L), 0.0, 1.0);
      // 高光：又小又亮的一点白，玻璃感全靠它
      vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
      float spec = pow(clamp(dot(n, H), 0.0, 1.0), 24.0);
      // 菲涅尔：边缘透光，珠子之间的缝隙才看得出是「一颗一颗」
      float fres = pow(1.0 - z, 2.6);

      vec3 bead = vColor * (0.58 + 0.86 * diff);
      bead += vec3(1.0, 0.93, 0.88) * spec * 1.15;
      bead += vColor * fres * 0.80;
      bead += vColor * vSpec * 0.55;
      float aBead = 1.0 - smoothstep(0.90, 1.0, t);

      // ---------- ② 虚化光斑 ----------
      float aBokeh = 1.0 - smoothstep(0.22, 1.0, t);
      float ring = smoothstep(0.34, 0.90, t) * (1.0 - smoothstep(0.90, 1.0, t));
      vec2 hp = p - vec2(-0.30, -0.33);
      float hl = exp(-dot(hp, hp) * 4.2);
      vec3 bokeh = vColor * (0.86 + 0.26 * ring) + vec3(1.0, 0.93, 0.88) * hl * 0.20;

      float m = smoothstep(0.0, 1.0, vSoft);
      vec3 col = mix(bead, bokeh, m);
      float a = mix(aBead, aBokeh, m) * vAlpha;

      if (a < 0.004) discard;

      // 预乘 alpha：叠在一起也不会糊成一片粉白
      gl_FragColor = vec4(col * a, a);
    }
  `;

  const H_VERT = `
    attribute float aSize;
    attribute float aSct;
    attribute vec3 aColor;
    uniform float uProj;
    uniform float uMix;
    uniform float uScale;
    varying vec3 vColor;
    varying float vFade;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = max(0.8, -mv.z);
      vColor = aColor;
      float sz = clamp(mix(aSize, aSct, uMix) * uScale * uProj / d, 2.0, 300.0);
      gl_PointSize = sz;
      // 大光斑的光晕淡一点，否则整屏会被加法混合烧白
      vFade = clamp(90.0 / sz, 0.25, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const H_FRAG = `
    precision highp float;
    varying vec3 vColor;
    varying float vFade;
    uniform float uHalo;
    void main() {
      float t = length(gl_PointCoord * 2.0 - 1.0);
      if (t > 1.0) discard;
      float a = pow(1.0 - t, 4.2);
      gl_FragColor = vec4(vColor * a * uHalo * vFade, 1.0);
    }
  `;

  function buildParticles() {
    if (P.built) return;
    const n = isMobile() ? 2600 : 4400;   // 池子比实际用量大一点，换模式时不用重建
    const rnd = mulberry32(4242);

    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const base = new Float32Array(n);
    const sct = new Float32Array(n);
    const seed = new Float32Array(n);
    const soft = new Float32Array(n);
    const alp = new Float32Array(n);
    const scA = new Float32Array(n);
    const delay = new Float32Array(n);

    // 参考视频的配色：以深胭脂红 / 正红为主，只在少数珠子上有一点点亮玫红。
    // 关键：绿色分量几乎为 0，一旦抬高就会立刻变粉、变廉价。
    const PALETTE = [
      [0.56, 0.008, 0.030], [0.62, 0.010, 0.034], [0.68, 0.012, 0.040],
      [0.74, 0.016, 0.046], [0.80, 0.020, 0.052], [0.86, 0.024, 0.060],
      [0.92, 0.030, 0.070], [0.98, 0.038, 0.084], [1.00, 0.050, 0.100],
      [0.84, 0.024, 0.115], [1.00, 0.085, 0.140],
    ];

    for (let i = 0; i < n; i++) {
      seed[i] = rnd();
      const c = PALETTE[(rnd() * PALETTE.length) | 0];
      const bright = 0.70 + Math.pow(rnd(), 0.90) * 0.50;
      col[i * 3] = clamp(c[0] * bright, 0, 1);
      col[i * 3 + 1] = clamp(c[1] * bright, 0, 1);
      col[i * 3 + 2] = clamp(c[2] * bright, 0, 1);

      // 聚合尺寸：大量小珠子填缝 + 少数大珠子压在前面 —— 大小差得越大，堆起来越像真的
      let sz = 0.34 + Math.pow(rnd(), 1.7) * 1.25;
      if (rnd() < 0.06) sz *= 1.30 + rnd() * 0.55;
      base[i] = sz;
      siz[i] = sz;

      // 散开：尺寸和透明度都跟分档绑定。
      // 远景碎屑必须又小又淡，中景那 8% 才是看得见的光斑 —— 这决定了散开像不像一整片星空。
      const tier = i % 100;
      if (tier < TIER_DUST) {
        sct[i] = 0.14 + Math.pow(rnd(), 1.9) * 0.30;
        scA[i] = 0.18 + rnd() * 0.26;
      } else if (tier < TIER_MID) {
        sct[i] = 0.55 + Math.pow(rnd(), 1.2) * 0.95;
        scA[i] = 0.24 + rnd() * 0.22;
      } else {
        sct[i] = 1.45 + rnd() * 0.95;
        scA[i] = 0.10 + rnd() * 0.12;
      }

      // 虚实跟着档位走：碎屑清晰、光斑化开
      if (tier < TIER_DUST) soft[i] = 0.04 + rnd() * 0.16;
      else if (tier < TIER_MID) soft[i] = 0.45 + rnd() * 0.35;
      else soft[i] = 0.88 + rnd() * 0.12;
      alp[i] = 0.72 + rnd() * 0.28;

      nrm[i * 3] = 0;
      nrm[i * 3 + 1] = 0;
      nrm[i * 3 + 2] = 1;                     // 占位，fillHeart 会重写
      delay[i] = rnd() * 0.42;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aNrm', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aSct', new THREE.BufferAttribute(sct, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('aSoft', new THREE.BufferAttribute(soft, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
    geo.setAttribute('aSctA', new THREE.BufferAttribute(scA, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uProj: { value: 900 },
        uTime: { value: 0 },
        uDrift: { value: 0.28 },
        uMix: { value: 0 },
        uSoftBias: { value: 0.04 },
        uD0: { value: 30 },
        uD1: { value: 70 },
        uBeat: { value: 0 },
        uAlpha: { value: 0 },
      },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
      fog: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 1;
    world.add(points);

    /* 发光层：同一批点再画一遍，只是画得更大、更软、用加法混合。
       珠子本身是「玻璃」，这一层才是「它在发光」—— 少了它，一堆红珠子会显得很闷。 */
    const hmat = new THREE.ShaderMaterial({
      uniforms: {
        uProj: { value: 900 },
        uMix: { value: 0 },
        uScale: { value: 1.7 },
        uHalo: { value: 0.20 },
      },
      vertexShader: H_VERT,
      fragmentShader: H_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const halo = new THREE.Points(geo, hmat);
    halo.frustumCulled = false;
    halo.renderOrder = 2;
    world.add(halo);
    P.halo = halo;

    P.n = n;
    P.points = points;
    P.geo = geo;
    P.posAttr = geo.getAttribute('position');
    P.nrm = nrm;
    P.nrmAttr = geo.getAttribute('aNrm');
    P.base = base;
    P.sizeArr = siz;
    P.sizeAttr = geo.getAttribute('aSize');
    P.mat = mat;
    P.haloMat = hmat;
    P.cur = pos;
    P.tgt = new Float32Array(n * 3);
    P.delay = delay;
    geo.setDrawRange(0, PARTICLE_N());
    P.drawCur = PARTICLE_N();
    P.drawTgt = PARTICLE_N();
    P.built = true;

    // 心形背后的一团红雾。用 Sprite（永远正对镜头）而不是平面板，
    // 否则场景一转，这块光板就侧过去消失了。
    const gm = new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0, fog: false,
    });
    const glow = new THREE.Sprite(gm);
    glow.position.set(0, 1.0, -14);
    glow.scale.setScalar(HEART_W * 2.0);
    glow.renderOrder = -1;
    scene.add(glow);
    P.glow = glow;
  }

  /* ---- 三种目标形状 ---- */
  function fillHeart() {
    const tgt = P.tgt, nrm = P.nrm, size = P.sizeArr, base = P.base;
    const rnd = mulberry32(101);
    const pts = HEART.pts;
    const cx = HEART.cx, cy = HEART.cy, k = HEART.k;
    const hw = HEART.halfW, hh = HEART.halfH;

    for (let i = 0; i < P.n; i++) {
      const p = pts[(rnd() * pts.length) | 0];
      const dn = p[2];                      // 0 = 贴着轮廓，1 = 最厚处

      // 略微内收：珠子中心留在轮廓里，边缘才不会毛糙
      const sc = k * (0.936 + 0.024 * dn);
      const x = (p[0] - cx + (rnd() - 0.5) * 1.8) * sc;
      const y = (cy - p[1] + (rnd() - 0.5) * 1.8) * sc;

      // 厚度场：中间厚、边缘薄，前后对称地鼓起来 —— 转过去背面也是饱满的
      const hz = H_DEPTH * Math.pow(dn, 0.46);
      const shell = rnd() < 0.84;           // 八成贴在外壳上，两成埋进去填密度
      const u = shell ? (0.78 + rnd() * 0.22) : (0.10 + rnd() * 0.64);
      const z = (rnd() < 0.5 ? 1 : -1) * hz * u;

      tgt[i * 3] = x;
      tgt[i * 3 + 1] = y + 1.0;
      tgt[i * 3 + 2] = z;

      // 伪法线：近似椭球穹顶的法线，交给顶点着色器算光
      nrm[i * 3] = x / hw;
      nrm[i * 3 + 1] = y / hh;
      nrm[i * 3 + 2] = hz > 0.02 ? (z / H_DEPTH) * 1.55 : 0.0;

      // 边缘珠子收小一点，轮廓更干净
      size[i] = base[i] * (0.58 + 0.42 * Math.pow(dn, 0.5));
    }
    P.sizeAttr.needsUpdate = true;
    P.nrmAttr && (P.nrmAttr.needsUpdate = true);
  }

  function fillText(str) {
    const box = measureText(str);
    const tgt = P.tgt, nrm = P.nrm, size = P.sizeArr, base = P.base;
    const rnd = mulberry32(202);
    if (!box) { fillHeart(); return; }
    const pts = sampleTextPts(str);
    for (let i = 0; i < P.n; i++) {
      const p = pts[(rnd() * pts.length) | 0];
      tgt[i * 3] = (p[0] - box.cx) * box.s + (rnd() - 0.5) * 0.14;
      tgt[i * 3 + 1] = (box.cy - p[1]) * box.s + (rnd() - 0.5) * 0.14;
      tgt[i * 3 + 2] = (rnd() - 0.5) * 3.0;
      nrm[i * 3] = (rnd() - 0.5) * 0.55;
      nrm[i * 3 + 1] = (rnd() - 0.5) * 0.55;
      nrm[i * 3 + 2] = 1;
      size[i] = base[i] * 0.9;
    }
    P.sizeAttr.needsUpdate = true;
  }

  function fillScatter(camD) {
    const tgt = P.tgt;
    const rnd = mulberry32(303);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = camera.aspect;

    for (let i = 0; i < P.n; i++) {
      // 三档：86% 远处碎屑 / 11% 中景光斑 / 3% 贴脸大光斑
      const tier = i % 100;
      let f;
      if (tier < TIER_DUST) f = 1.90 + Math.pow(rnd(), 0.72) * 2.20;
      else if (tier < TIER_MID) f = 0.70 + rnd() * 0.60;
      else f = 0.36 + rnd() * 0.22;

      const dz = camD * f;
      const hh = tan * dz;
      const hw = hh * aspect;

      let x, y;
      if (tier >= TIER_MID) {
        // 贴脸的大光斑甩到画面外圈，别糊在正中间挡住心
        const a = rnd() * TAU;
        const rr = 0.58 + rnd() * 0.62;
        x = Math.cos(a) * hw * rr;
        y = Math.sin(a) * hh * rr;
      } else {
        // 屏幕空间里均匀铺：x/y 直接就是画面上的位置比例。
        // 用高斯会全挤在中间（近处的颗粒一个就占半屏），整屏就成了一团红雾。
        let u = rnd() * 2 - 1;
        let v = rnd() * 2 - 1;
        if (rnd() < 0.30) { u *= 0.58; v *= 0.58; }   // 留三成靠近中心，别太散
        x = u * hw * 1.02;
        y = v * hh * 1.02;
      }

      tgt[i * 3] = x;
      tgt[i * 3 + 1] = y;
      tgt[i * 3 + 2] = camD - dz;
    }
  }

  /* ============================================================
     ② 照片卡
     ============================================================ */
  const state = {
    items: [],
    cards: [],
    gather: true,
    viewIdx: -1,
    cardLimit: 0,
  };

  const texCache = new Map();

  function disposeCards() {
    state.cards.forEach((c) => {
      world.remove(c.mesh);
      if (c.mesh.material) c.mesh.material.dispose();
    });
    state.cards = [];
  }

  function loadImage(src, timeout) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const fin = (v) => { if (!done) { done = true; resolve(v); } };
      img.onload = () => fin(img);
      img.onerror = () => fin(null);
      img.src = src;
      setTimeout(() => fin(img.complete && img.naturalWidth ? img : null), timeout || 12000);
    });
  }

  /** 视频取首帧当封面 */
  function grabPoster(src) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      let done = false;
      const fin = (val) => {
        if (done) return;
        done = true;
        try { v.removeAttribute('src'); v.load(); } catch (e) { /* ignore */ }
        resolve(val);
      };
      const snap = () => {
        try {
          const w = v.videoWidth || 640, h = v.videoHeight || 360;
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(v, 0, 0, w, h);
          const img = new Image();
          img.onload = () => fin(img);
          img.onerror = () => fin(null);
          img.src = cv.toDataURL('image/jpeg', 0.85);
          return true;
        } catch (e) { return false; }
      };
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      v.onloadeddata = () => {
        if (!snap()) { try { v.currentTime = Math.min(0.4, (v.duration || 1) * 0.2); } catch (e) { fin(null); } }
      };
      v.onseeked = () => { if (!snap()) fin(null); };
      v.onerror = () => fin(null);
      v.src = src;
      setTimeout(() => { if (!snap()) fin(null); }, 9000);
    });
  }

  /** 每次重建都会有新序号，防止连点滑杆时旧的一批覆盖新的 */
  let cardBuildSeq = 0;

  async function buildCards(items, shuffle) {
    const seq = ++cardBuildSeq;
    disposeCards();
    const cap = isMobile() ? 24 : 48;
    const want = clamp(Math.round(CFG.cards) || 20, 6, cap);
    state.cardLimit = Math.min(items.length, want);
    if (!state.cardLimit) return;

    const pool = items.slice();
    if (shuffle) pool.sort(() => Math.random() - 0.5);
    const picks = pool.slice(0, state.cardLimit);
    const texSize = 420;   // 固定尺寸：滑杆调数量时直接复用缓存，不用重新解码

    // 一张贴图好了就立刻挂上去，别等全部洗完（否则调数量时场景会空几秒）
    const addCard = (it, tex) => {
      if (seq !== cardBuildSeq) return;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, alphaTest: 0.5,
        side: THREE.DoubleSide, toneMapped: false, fog: false,
      });
      const mesh = new THREE.Mesh(geoPlane, mat);
      mesh.renderOrder = 0;   // 先画照片并写深度，粒子在后面才不会「穿透」照片
      mesh.scale.setScalar(0.001);
      mesh.visible = true;
      world.add(mesh);
      const rnd = mulberry32(555 + state.cards.length * 31);
      state.cards.push({
        mesh, tex, item: it,
        itemIndex: state.items.indexOf(it),
        cur: new THREE.Vector3(),
        tgt: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        seed: rnd(),
        spin: (rnd() - 0.5) * 0.42,
        tilt: (rnd() - 0.5) * 0.30,
        orb: { r: 20, y: 0, phase: 0, spd: 0.06, depth: 0.7, wob: 0 },
        sc: 0.001,
        scTgt: 3,
        appear: 0,
      });
      layoutCards();
    };

    let idx = 0, done = 0;
    const worker = async () => {
      while (idx < picks.length) {
        const k = idx++;
        const it = picks[k];
        const key = it.src + '@' + texSize;
        if (texCache.has(key)) { addCard(it, texCache.get(key)); continue; }
        const img = it.type === 'video' ? await grabPoster(it.src) : await loadImage(it.src);
        if (img) {
          try {
            const tex = makeCardTexture(img, texSize, it.type === 'video');
            texCache.set(key, tex);
            addCard(it, tex);
          } catch (e) { /* skip */ }
        }
        done++;
        if (done % 4 === 0) setLoader(true, '正在洗照片… ' + done + ' / ' + picks.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (seq === cardBuildSeq) layoutCards();
  }

  function layoutCards() {
    const n = state.cards.length;
    if (!n) return;
    const rnd = mulberry32(state.gather ? 707 : 808);
    const dir = state.gather ? 1 : -1;

    // 轨道半径按「当前画面能看见多宽」来算，手机竖屏和电脑宽屏才都不会跑出画外
    const tanH = Math.tan((camera.fov * Math.PI) / 360);
    const halfH = tanH * camDist;
    const halfW = halfH * camera.aspect;
    const kk = clamp(halfW / 30, 0.5, 1.15);   // 卡片大小跟着画面宽度缩

    state.cards.forEach((c, i) => {
      if (state.gather) {
        // 绕着心形转的轨道：半径在心形外侧，靠 depth 决定这一张转到前面还是后面
        // 内圈必须比心形宽一点，否则照片会糊在心口上
        const rMin = HEART.halfW * 1.26;
        const rMax = Math.max(halfW * 0.95, rMin + 5);
        c.orb.r = rMin + rnd() * (rMax - rMin);
        // 高度整体偏下一点：上面要留给标题，别让照片压住字
        c.orb.y = halfH * (0.22 - rnd() * 0.62);
        c.orb.phase = (i / n) * TAU + (rnd() - 0.5) * 0.34;
        c.orb.spd = (0.045 + rnd() * 0.05) * dir;
        c.orb.depth = 0.46 + rnd() * 0.44;
        c.orb.wob = rnd() * TAU;
        c.scTgt = (2.0 + rnd() * 1.5) * kk;
      } else {
        // 散开时照片飘得更开，同样慢慢绕
        const rMinS = HEART.halfW * 0.9;
        const rMaxS = Math.max(halfW * 1.0, rMinS + 8);
        c.orb.r = rMinS + rnd() * (rMaxS - rMinS);
        c.orb.y = (rnd() * 2 - 1) * halfH * 0.52;
        c.orb.phase = rnd() * TAU;
        c.orb.spd = (0.05 + rnd() * 0.06) * dir;
        c.orb.depth = 0.35 + rnd() * 0.55;
        c.orb.wob = rnd() * TAU;
        c.scTgt = (1.5 + rnd() * 1.2) * kk;
      }

      // 每张自己的小角度：正对镜头再偏一点，既有立体感又看得清照片
      c.yaw = (rnd() - 0.5) * 0.75;
      c.pitch = (rnd() - 0.5) * 0.30;
      c.roll = (rnd() - 0.5) * 0.24;
      if (c.delay === undefined) c.delay = rnd() * 0.25;
      placeCard(c, 0);
    });
  }

  /** 轨道 → 目标位置。每帧调用，照片就会慢慢地绕着心形转 */
  function placeCard(c, t) {
    const o = c.orb;
    const a = o.phase + t * o.spd;
    c.tgt.set(
      Math.cos(a) * o.r,
      o.y + Math.sin(t * 0.55 + o.wob) * 0.8,
      Math.sin(a) * o.r * o.depth
    );
  }

  /* ---------------- 机位 ---------------- */
  let camDist = 60;
  const camTarget = new THREE.Vector3(0, 0, 60);

  function distFor(halfW, halfH, fill) {
    const W = Math.max(320, window.innerWidth);
    const H = Math.max(320, window.innerHeight);
    const padTop = 84;
    const padBottom = W < 760 ? 172 : 124;
    const availW = Math.max(160, W - 40);
    const availH = Math.max(140, H - padTop - padBottom);
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const dH = (halfH * H) / (tan * availH * fill);
    const dW = (halfW * H) / (tan * availW * fill);
    return clamp(Math.max(dH, dW) * (100 / CFG.cam), 14, 320);
  }

  /* ---------------- 布局 ---------------- */
  function layout(instant) {
    if (!P.built) return;

    const useText = state.gather && CFG.shape === 'text' && CFG.gatherText.trim();

    const portrait = window.innerHeight > window.innerWidth;
    const baseFill = portrait ? 0.78 : 0.78;
    if (state.gather) {
      if (useText) {
        measureText(CFG.gatherText.trim());
        camDist = distFor(TEXT.halfW, TEXT.halfH, portrait ? 0.94 : 0.76);
      } else {
        camDist = distFor(HEART.halfW, HEART.halfH, baseFill);
      }
    } else {
      // 散开时把镜头推进云里（否则云显得又远又稀）
      camDist = distFor(HEART.halfW, HEART.halfH, baseFill) * 0.56;
    }
    camTarget.set(0, 0, camDist);

    if (state.gather) {
      if (useText) fillText(CFG.gatherText.trim());
      else fillHeart();
      P.mat.uniforms.uDrift.value = 0.20;
      // 聚合：珠子清晰、实心，一颗颗都看得见
      LOOK_T.mix = 0;
      LOOK_T.soft = 0.04;
      LOOK_T.alpha = 1.0;
      P.mat.uniforms.uD0.value = camDist - 9;
      P.mat.uniforms.uD1.value = camDist + 9;
      P.mat.uniforms.uBeat.value = useText ? 0 : 0.016;
      P.glowT = 0.46;
    } else {
      fillScatter(camDist);
      P.mat.uniforms.uDrift.value = 0.9;
      // 散开：放大 + 虚化，变成一片红色光斑
      LOOK_T.mix = 1;
      LOOK_T.soft = 0.30;
      LOOK_T.alpha = 0.95;
      P.mat.uniforms.uD0.value = camDist * 0.45;
      P.mat.uniforms.uD1.value = camDist * 2.4;
      P.mat.uniforms.uBeat.value = 0;
      P.glowT = 0;
    }
    // 聚合只画前 N 颗（每颗都看得清）；散开时多画一些，但也别把整池都倒出来 ——
    // 数量一多，满屏就是一层红雾，什么层次都没了。
    P.drawTgt = state.gather ? PARTICLE_N() : PARTICLE_MAX();

    if (instant) {
      Object.assign(LOOK, LOOK_T);
      P.cur.set(P.tgt);
      P.posAttr.needsUpdate = true;
    }
    P.delay.forEach((v, i) => { P.delay[i] = (i % 40) * 0.012; });

    layoutCards();
    if (instant) {
      state.cards.forEach((c) => {
        c.cur.copy(c.tgt);
        c.sc = c.scTgt;
        c.appear = 1;
        c.mesh.visible = true;
        c.mesh.position.copy(c.tgt);
        c.mesh.scale.setScalar(c.scTgt);
      });
    }

    $('#btn-gather').classList.toggle('active', state.gather);
    $('#btn-scatter').classList.toggle('active', !state.gather);
  }

  /* ---------------- 视角 ---------------- */
  let theta = 0, phi = 0, thetaVel = 0, phiVel = 0;
  let dragging = false, lastX = 0, lastY = 0, dragDist = 0;
  let lastUserT = -99;   // 用户最后一次主动转动的时间（判断要不要自动回正）
  let nowT = 0;          // 与 clock.elapsedTime 同一时钟，事件回调里也能用
  const rotE = new THREE.Euler(0, 0, 0, 'YXZ');
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  let hovered = null;
  let handOn = false;
  let fistDone = 0;

  function setPointer(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (state.viewIdx >= 0) return;
    dragging = true; dragDist = 0;
    lastX = e.clientX; lastY = e.clientY;
    thetaVel = phiVel = 0;
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });

  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    dragDist += Math.abs(dx) + Math.abs(dy);
    theta += dx * 0.0042;
    phi = clamp(phi + dy * 0.0032, -0.65, 0.65);
    lastUserT = nowT;
    thetaVel = dx * 0.0042;
    phiVel = dy * 0.0032;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    if (dragDist < 8 && hovered) openViewer(hovered.itemIndex);
    try {
      if (e && e.pointerId != null && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch (err) { /* ignore */ }
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { pointer.set(9, 9); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camDist = clamp(camDist + e.deltaY * 0.045, 12, 320);
    camTarget.set(0, 0, camDist);
  }, { passive: false });

  let pinchStart = 0, pinchBase = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchStart = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      pinchBase = camDist;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && pinchStart > 0) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      camDist = clamp(pinchBase * (pinchStart / Math.max(1, d)), 12, 320);
      camTarget.set(0, 0, camDist);
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => { pinchStart = 0; }, { passive: true });

  /* ---------------- 大图 / 视频浏览 ---------------- */
  const viewer = $('#viewer');
  const vImg = $('#v-img');
  const vVideo = $('#v-video');

  function openViewer(i) {
    if (!state.items.length) return;
    state.viewIdx = i >= 0 ? i : 0;
    document.body.classList.add('focused');
    viewer.classList.add('on');
    showItem(state.viewIdx);
  }

  function closeViewer() {
    state.viewIdx = -1;
    document.body.classList.remove('focused');
    viewer.classList.remove('on');
    try { vVideo.pause(); } catch (e) { /* ignore */ }
    vVideo.removeAttribute('src');
    vVideo.load();
  }

  function showItem(index) {
    const list = state.items;
    if (!list.length) return;
    const i = ((index % list.length) + list.length) % list.length;
    state.viewIdx = i;
    const it = list[i];
    $('#v-count').textContent = (i + 1) + ' / ' + list.length;

    if (it.type === 'video') {
      vImg.style.display = 'none';
      vVideo.style.display = 'block';
      if (vVideo.getAttribute('src') !== it.src) vVideo.src = it.src;
      vVideo.play().catch(() => { /* 浏览器可能要求再点一次 */ });
    } else {
      try { vVideo.pause(); } catch (e) { /* ignore */ }
      vVideo.style.display = 'none';
      vImg.style.display = 'block';
      vImg.src = it.src;
    }
  }

  function nextItem(step) {
    if (state.viewIdx < 0) { openViewer(0); return; }
    showItem(state.viewIdx + step);
  }

  $('#v-prev').addEventListener('click', (e) => { e.stopPropagation(); nextItem(-1); });
  $('#v-next').addEventListener('click', (e) => { e.stopPropagation(); nextItem(1); });
  viewer.addEventListener('click', (e) => {
    if (e.target === viewer || e.target.classList.contains('viewer-stage')) closeViewer();
  });

  /* ---------------- 聚合 / 散开 ---------------- */
  function doGather() {
    if (state.gather) { layout(false); return; }
    state.gather = true;
    layout(false);
    showToast('聚合');
  }
  function doScatter() {
    if (!state.gather) { layout(false); return; }
    state.gather = false;
    layout(false);
    showToast('散开');
  }

  window.addEventListener('gesture:fist', () => { if (state.viewIdx < 0) doGather(); });
  window.addEventListener('gesture:open', () => { if (state.viewIdx < 0) doScatter(); });

  // 捏合 = 「按住看大图，松开关掉」：
  // 捏住时打开一张，手指松开就自动收起来，像按一下实体按钮。
  let pinchHolding = false;
  let pinchCursor = 0;
  window.addEventListener('gesture:pinch-start', () => {
    if (pinchHolding || !state.items.length) return;
    pinchHolding = true;
    openViewer(pinchCursor % state.items.length);
  });
  window.addEventListener('gesture:pinch-end', () => {
    if (!pinchHolding) return;
    pinchHolding = false;
    pinchCursor++;
    closeViewer();
  });

  /* ---------------- 摄像头 ---------------- */
  const handcam = $('#handcam');
  const handTag = $('#handcam-tag');
  const handDot = $('#handcam-dot');
  const btnHand = $('#btn-hand');
  let handTagTxt = '';

  function setHandTag(txt, cls) {
    if (txt !== handTagTxt) { handTag.textContent = txt; handTagTxt = txt; }
    const c = 'handcam-dot' + (cls ? ' ' + cls : '');
    if (handDot.className !== c) handDot.className = c;
  }

  function updateHandHud(hs, live) {
    if (!live) { setHandTag('把手放进画面里', ''); return; }
    if (hs.open < 0.3) setHandTag('握拳 · 聚合', 'act');
    else if (hs.pinch > 0.66) setHandTag('捏住 · 看大图', 'act');
    else if (hs.open > 0.72) setHandTag('张手 · 散开', 'act');
    else setHandTag('已识别 · 左右移动转动', 'live');
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function ensureGesture() {
    if (window.__Gesture) return window.__Gesture;
    // 模块是普通脚本 + 懒加载，正常情况早就注册好了；
    // 这里再等 3 秒兜底，避免用户手快点到「手势」只看到一句「还在加载」。
    for (let i = 0; i < 20; i++) {
      await wait(150);
      if (window.__Gesture) return window.__Gesture;
    }
    return null;
  }

  async function toggleHand() {
    if (handOn) {
      if (window.__Gesture) window.__Gesture.stop();
      handOn = false;
      handcam.classList.remove('on');
      btnHand.classList.remove('on');
      $('#txt-hand').textContent = '手势';
      showToast('已关闭摄像头手势');
      return;
    }

    handcam.classList.add('on');
    btnHand.classList.add('on');
    $('#txt-hand').textContent = '开启中';
    setHandTag('正在打开摄像头…', '');

    const G = await ensureGesture();
    if (!G) {
      handcam.classList.remove('on');
      btnHand.classList.remove('on');
      $('#txt-hand').textContent = '手势';
      showToast('手势脚本没加载出来：请用「启动.bat」打开，别直接双击 index.html');
      return;
    }

    const ok = await G.start($('#handvideo'), $('#handcanvas'));
    if (!ok) {
      handcam.classList.remove('on');
      btnHand.classList.remove('on');
      $('#txt-hand').textContent = '手势';
      const st = G.state;
      if (st.status === 'denied') showToast('摄像头权限被拒绝：点地址栏相机图标允许后重试');
      else if (location.protocol === 'file:') showToast('手势需要在本地服务下运行：双击「启动.bat」');
      else showToast('摄像头启动失败：' + (st.error || '未知原因'));
      return;
    }
    handOn = true;
    if (window.__handState) window.__handState.mirror = CFG.mirror;
    $('#txt-hand').textContent = '手势中';
    // 每次打开手势都把说明露出来（之前只第一次显示，用户第二次就再也找不到）
    showGestureCard(true);
    // 15 秒没动作也自动收起
    setTimeout(() => { if (gcard.classList.contains('on')) showGestureCard(false); }, 15000);
    showToast('手势已开启：握拳聚合 · 张手散开 · 捏住看大图');
  }

  btnHand.addEventListener('click', toggleHand);
  $('#handcam-close').addEventListener('click', () => { if (handOn) toggleHand(); });

  /* ---------------- 手势使用说明卡 ---------------- */
  const gcard = $('#gcard');
  const btnHelp = $('#btn-help');

  function showGestureCard(on) {
    gcard.classList.toggle('on', !!on);
    btnHelp.classList.toggle('on', !!on);
    // 手机上说明卡会顶到提示条的位置，交给 CSS 把 toast 挪到顶部
    document.body.classList.toggle('card-open', !!on);
  }
  // 只要认出真实手势，就把说明收起来 —— 说明已经用不上了，别一直挡着画面
  ['gesture:fist', 'gesture:open', 'gesture:pinch-start'].forEach((n) => {
    window.addEventListener(n, () => {
      if (gcard.classList.contains('on')) {
        showGestureCard(false);
        showToast('已识别到手势，说明已收起（点「? 说明」可再看）');
      }
    });
  });

  btnHelp.addEventListener('click', () => {
    // 没开摄像头也能看说明；顺便提示一句怎么开
    showGestureCard(!gcard.classList.contains('on'));
  });
  $('#gcard-ok').addEventListener('click', () => showGestureCard(false));

  // Esc 先关说明卡
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (gcard.classList.contains('on')) {
      showGestureCard(false);
      e.stopPropagation();
    }
  }, true);

  /* ---------------- 文字 ---------------- */
  function applyText() {
    if (!CFG.title.trim()) CFG.title = DEFAULTS.title;
    $('#title').textContent = CFG.title;
    $('#intro-title').textContent = CFG.title;
    $('#subtitle').textContent = CFG.sub;
    $('#intro-sub').textContent = CFG.sub;
    const showSub = !!CFG.showSub && !!CFG.sub.trim();
    $('#subtitle').style.display = showSub ? '' : 'none';
    $('#intro-sub').style.display = showSub ? '' : 'none';
  }

  /* ---------------- 设置面板 ---------------- */
  const panel = $('#panel');
  let recardTimer = 0;

  function syncPanel() {
    $('#in-title').value = CFG.title;
    $('#in-sub').value = CFG.sub;
    $('#in-showsub').checked = !!CFG.showSub;
    $('#in-text').value = CFG.gatherText;
    $('#in-vol').value = CFG.vol;
    $('#in-mirror').checked = !!CFG.mirror;
    $('#in-speed').value = CFG.speed;
    $('#in-cam').value = CFG.cam;
    $('#in-fog').value = CFG.fog;
    $('#in-stars').value = CFG.stars;
    $('#in-cards').value = CFG.cards;
    $$('#seg-shape button').forEach((b) => {
      b.classList.toggle('active', b.dataset.shape === CFG.shape);
    });
  }

  function togglePanel(on) {
    panel.classList.toggle('on', on);
    document.body.classList.toggle('panel-open', on);
  }

  function bindPanel() {
    syncPanel();

    $('#in-title').addEventListener('input', (e) => { CFG.title = e.target.value; applyText(); saveCfg(); });
    $('#in-sub').addEventListener('input', (e) => { CFG.sub = e.target.value; applyText(); saveCfg(); });
    $('#in-showsub').addEventListener('change', (e) => { CFG.showSub = e.target.checked; applyText(); saveCfg(); });
    $('#in-text').addEventListener('input', (e) => {
      CFG.gatherText = e.target.value;
      if (CFG.shape === 'text' && state.gather) layout(false);
      saveCfg();
    });
    $('#in-vol').addEventListener('input', (e) => {
      CFG.vol = Number(e.target.value);
      bgm.volume = CFG.vol / 100;
      saveCfg();
    });
    $('#in-mirror').addEventListener('change', (e) => {
      CFG.mirror = e.target.checked;
      if (window.__handState) window.__handState.mirror = CFG.mirror;
      saveCfg();
    });
    $('#in-speed').addEventListener('input', (e) => { CFG.speed = Number(e.target.value); saveCfg(); });
    $('#in-cam').addEventListener('input', (e) => {
      CFG.cam = Number(e.target.value);
      layout(false);
      saveCfg();
    });
    $('#in-fog').addEventListener('input', (e) => { CFG.fog = Number(e.target.value); saveCfg(); });
    $('#in-stars').addEventListener('input', (e) => { CFG.stars = Number(e.target.value); applyStars(); saveCfg(); });
    $('#in-cards').addEventListener('input', (e) => {
      CFG.cards = Number(e.target.value);
      saveCfg();
      clearTimeout(recardTimer);
      recardTimer = setTimeout(() => {
        if (!state.items.length) return;
        buildCards(state.items, false).then(() => { layout(false); updateMediaInfo(); });
      }, 260);
    });

    $$('#seg-shape button').forEach((b) => {
      b.addEventListener('click', () => {
        CFG.shape = b.dataset.shape;
        $$('#seg-shape button').forEach((x) => x.classList.toggle('active', x === b));
        state.gather = true;
        layout(false);
        saveCfg();
      });
    });

    $('#btn-reset').addEventListener('click', () => {
      Object.assign(CFG, DEFAULTS);
      saveCfg();
      applyText();
      syncPanel();
      applyStars();
      state.gather = true;
      layout(false);
      showToast('已恢复默认');
    });

    $('#btn-pick').addEventListener('click', () => $('#picker').click());
    $('#btn-reshuffle').addEventListener('click', () => reload(true));
    $('#panel-x').addEventListener('click', () => togglePanel(false));
  }

  $('#btn-set').addEventListener('click', () => togglePanel(!panel.classList.contains('on')));

  /* ---------------- 音乐 ---------------- */
  const bgm = $('#bgm');
  let musicOn = false;

  function toggleMusic() {
    if (!musicOn) {
      if (!bgm.getAttribute('src')) bgm.src = 'music/bgm.mp3';
      bgm.volume = CFG.vol / 100;
      bgm.play().then(() => {
        musicOn = true;
        $('#ico-music').textContent = '❙❙';
        $('#btn-music').classList.add('on');
      }).catch(() => {
        showToast('没找到 music/bgm.mp3，放一首进去即可');
      });
    } else {
      bgm.pause();
      musicOn = false;
      $('#ico-music').textContent = '♪';
      $('#btn-music').classList.remove('on');
    }
  }
  $('#btn-music').addEventListener('click', toggleMusic);

  /* ---------------- 全屏 ---------------- */
  $('#btn-full').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  });

  /* ---------------- 媒体清单 ---------------- */
  const isVideoName = (n) => /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(n || '');

  async function fetchManifest() {
    let items = null;
    try {
      const r = await fetch('api/manifest', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.items && j.items.length) items = j.items;
      }
    } catch (e) { /* file:// 下没有服务 */ }

    if (!items) {
      try {
        const r = await fetch('photos/manifest.json', { cache: 'no-store' });
        if (r.ok) {
          const names = await r.json();
          if (names && names.length) {
            items = names.map((n) => ({
              type: isVideoName(n) ? 'video' : 'image',
              src: 'photos/' + encodeURIComponent(n),
              name: n,
            }));
          }
        }
      } catch (e) { /* ignore */ }
    }

    if (!items) {
      items = (window.__DEMO_PHOTOS || []).map((src, i) => ({
        type: 'image', src, name: '示例 ' + (i + 1) + '.jpg', demo: true,
      }));
    }
    return items;
  }

  /* ---------------- 导入 ---------------- */
  const picker = $('#picker');

  function loadFromFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      if (/^video\//.test(file.type)) {
        grabPoster(url).then((img) => resolve({ item: { type: 'video', src: url, name: file.name }, img }));
      } else {
        loadImage(url).then((img) => resolve({ item: { type: 'image', src: url, name: file.name }, img }));
      }
    });
  }

  async function importFiles(files) {
    const arr = [...files].filter((f) => /^(image|video)\//.test(f.type));
    if (!arr.length) { showToast('请选择图片或视频'); return; }
    setLoader(true, '正在导入…');
    const local = [];
    for (let i = 0; i < arr.length; i++) {
      const r = await loadFromFile(arr[i]);
      if (r && r.img) local.push({ item: r.item, tex: makeCardTexture(r.img, 440, r.item.type === 'video') });
      setLoader(true, '正在导入… ' + (i + 1) + ' / ' + arr.length);
    }
    if (!local.length) { setLoader(false); showToast('这些文件没能读出画面'); return; }

    state.items = state.items.concat(local.map((e) => e.item));
    const rnd = mulberry32(Date.now() & 0xffff);
    local.slice(0, 10).forEach((e) => {
      const mat = new THREE.MeshBasicMaterial({
        map: e.tex, transparent: true, alphaTest: 0.5,
        side: THREE.DoubleSide, toneMapped: false, fog: false,
      });
      const mesh = new THREE.Mesh(geoPlane, mat);
      mesh.renderOrder = 0;   // 先画照片并写深度，粒子在后面才不会「穿透」照片
      mesh.scale.setScalar(0.001);
      world.add(mesh);
      state.cards.push({
        mesh, tex: e.tex, item: e.item, itemIndex: state.items.indexOf(e.item),
        cur: new THREE.Vector3(), tgt: new THREE.Vector3(),
        quat: new THREE.Quaternion(), seed: rnd(),
        spin: (rnd() - 0.5) * 0.5, tilt: (rnd() - 0.5) * 0.3,
        sc: 0.001, scTgt: 3, appear: 0, delay: 0,
      });
    });
    layoutCards();
    setLoader(false);
    updateMediaInfo();
    showToast('已导入 ' + local.length + ' 个文件');
  }

  picker.addEventListener('change', (e) => {
    importFiles(e.target.files).then(() => { picker.value = ''; });
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
  });

  /* ---------------- 提示 ---------------- */
  let toastTimer = 0;
  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
  }

  function setLoader(on, msg) {
    $('#loader').classList.toggle('on', !!on);
    if (msg) $('#loader-txt').textContent = msg;
  }

  function updateMediaInfo() {
    const total = state.items.length;
    const vids = state.items.filter((i) => i.type === 'video').length;
    $('#media-info').textContent =
      '共 ' + total + ' 个文件（图片 ' + (total - vids) + ' / 视频 ' + vids +
      '）· 3D 场景里同时展示 ' + state.cards.length + ' 张，其余用「下一张」看';
  }

  /* ---------------- 尺寸 ---------------- */
  let resizeTimer = 0;
  function updateProj() {
    if (P.mat) {
      P.mat.uniforms.uProj.value =
        (window.innerHeight * renderer.getPixelRatio()) /
        (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(lowQ ? 1 : Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(w, h, false);
    updateProj();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (P.built) layout(false);
    }, 200);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ---------------- 主循环 ---------------- */
  const clock = new THREE.Clock();
  let opacityT = 0;

  // 低配自动降级：这台机器的显卡明显跑不动时，先把像素比和发光层关掉，
  // 保证画面是动的 —— 光斑本来就是糊的，降一半像素比肉眼看不太出来。
  const NO_DOWNGRADE = /[?&]hq=1/.test(location.search);   // 调试/截图时不让它自己降
  let lowQ = false, fpsFrames = 0, fpsClock = 0, bootT = 0;
  function autoQuality(dt) {
    if (lowQ || NO_DOWNGRADE) return;
    bootT += dt;
    if (bootT < 6) return;          // 头几秒在加载贴图，帧率不准，别急着降
    fpsFrames++;
    fpsClock += dt;
    if (fpsClock < 2.5) return;
    const fps = fpsFrames / fpsClock;
    fpsFrames = 0; fpsClock = 0;
    if (fps < 24) {
      lowQ = true;
      renderer.setPixelRatio(1);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      updateProj();
      if (P.halo) P.halo.visible = false;
      if (P.points) P.points.material.uniforms.uSoftBias.value += 0.08;
      showToast('检测到画面有点吃力：已自动降低画质');
    }
  }

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    nowT = t;
    autoQuality(dt);

    const aw = canvas.clientWidth, ah = canvas.clientHeight;
    if (aw && ah && Math.abs(camera.aspect - aw / ah) > 0.008) onResize();

    const hs = window.__handState;
    const handReady = handOn && hs && hs.status === 'ready';
    const handLive = handReady && hs.present;

    /* 1. 视角 */
    if (!dragging) {
      theta += thetaVel;
      phi = clamp(phi + phiVel, -0.65, 0.65);
      thetaVel *= 0.93;
      phiVel *= 0.93;
      if (handLive && state.viewIdx < 0) {
        const dead = 0.06;
        const dxh = hs.x - 0.5, dyh = hs.y - 0.5;
        const ax = Math.abs(dxh) < dead ? 0 : (dxh - Math.sign(dxh) * dead) / (0.5 - dead);
        const ay = Math.abs(dyh) < dead ? 0 : (dyh - Math.sign(dyh) * dead) / (0.5 - dead);
        theta += ax * 2.6 * dt;
        phi = clamp(phi + ay * 1.4 * dt, -0.65, 0.65);
        if (Math.abs(dxh) > 0.12 || Math.abs(dyh) > 0.12) lastUserT = t;
      } else if (state.viewIdx < 0) {
        if (state.gather) {
          // 聚合时不让它整圈转（转到侧面就成一条红柱了），
          // 改成很慢的左右摇摆，心形始终认得出来，又能看出体积。
          const sway = Math.sin(t * 0.28) * 0.44 * (CFG.speed / 100);
          const back = t - lastUserT > 3.5;
          theta += ((back ? sway : theta) - theta) * Math.min(1, dt * (back ? 0.55 : 2.4));
          phi += (0 - phi) * Math.min(1, dt * 1.6);
        } else {
          // 散开时慢慢转（转快了深处的粒子会被「甩」到一边，画面就不均匀了）
          theta += 0.022 * (CFG.speed / 100) * dt;
        }
      }
    }
    rotE.set(phi, theta, 0);
    world.rotation.set(phi, theta, 0);

    /* 2. 相机 */
    if (state.viewIdx < 0) camTarget.set(0, 0, camDist + Math.sin(t * 0.4) * 0.8);
    const ck = 1 - Math.pow(0.0025, dt);
    camera.position.lerp(camTarget, ck);
    camera.lookAt(0, 0, 0);

    /* 3. 粒子 */
    if (P.built) {
      opacityT = Math.min(1, opacityT + dt * 0.9);
      // 聚合 / 散开之间，尺寸、虚化、亮度都平滑过渡
      const lk = 1 - Math.pow(0.006, dt);
      LOOK.mix += (LOOK_T.mix - LOOK.mix) * lk;
      LOOK.soft += (LOOK_T.soft - LOOK.soft) * lk;
      LOOK.alpha += (LOOK_T.alpha - LOOK.alpha) * lk;

      if (P.drawCur !== undefined && Math.abs(P.drawCur - P.drawTgt) > 1) {
        P.drawCur += (P.drawTgt - P.drawCur) * Math.min(1, dt * 2.6);
        P.geo.setDrawRange(0, Math.round(P.drawCur));
      }

      const u = P.mat.uniforms;
      u.uAlpha.value = LOOK.alpha * opacityT;
      u.uMix.value = LOOK.mix;
      u.uSoftBias.value = LOOK.soft;
      u.uTime.value = t;

      if (P.haloMat) {
        const hu = P.haloMat.uniforms;
        hu.uProj.value = u.uProj.value;
        hu.uMix.value = LOOK.mix;
        // 聚合时发光要明显；散开时只留一点点，不然满屏红光
        hu.uHalo.value = (0.09 - 0.05 * LOOK.mix) * opacityT;
      }

      if (P.glow) {
        const gm = P.glow.material;
        gm.opacity += ((P.glowT || 0) * opacityT - gm.opacity) * lk;
        const gp = 1 + Math.sin(t * 0.9) * 0.02;
        P.glow.scale.set(HEART_W * 2.0 * gp, HEART_W * 2.0 * gp, 1);
      }

      const k = 1 - Math.pow(0.0045, dt);
      const cur = P.cur, tgt = P.tgt, delay = P.delay;
      for (let i = 0; i < P.n; i++) {
        const a = i * 3;
        if (delay[i] > 0) { delay[i] -= dt; continue; }
        cur[a] += (tgt[a] - cur[a]) * k;
        cur[a + 1] += (tgt[a + 1] - cur[a + 1]) * k;
        cur[a + 2] += (tgt[a + 2] - cur[a + 2]) * k;
      }
      P.posAttr.needsUpdate = true;
    }

    /* 4. 照片卡 */
    const ck2 = 1 - Math.pow(0.010, dt);
    for (let i = 0; i < state.cards.length; i++) {
      const c = state.cards[i];
      if (c.delay > 0) { c.delay -= dt; continue; }
      placeCard(c, t);
      c.cur.lerp(c.tgt, ck2);
      c.mesh.position.copy(c.cur);
      c.appear = Math.min(1, c.appear + dt * 1.8);
      c.sc += (c.scTgt - c.sc) * Math.min(1, dt * 3.4);
      const hs2 = hovered === c ? 1.12 : 1;
      c.mesh.scale.setScalar(c.sc * c.appear * hs2);
      // 始终大致朝向镜头，再叠一点自己的偏角和慢慢摆动 —— 照片永远看得清
      c.mesh.lookAt(camera.position);
      c.mesh.rotateY(c.yaw + Math.sin(t * 0.42 + c.seed * 6.28) * 0.22 + c.spin * 0.35);
      c.mesh.rotateX(c.pitch + Math.sin(t * 0.31 + c.seed * 4.1) * 0.10);
      c.mesh.rotateZ(c.roll);
      c.mesh.visible = c.appear > 0.02;
    }

    /* 5. 背景 */
    if (sky.stars) sky.stars.rotation.y += dt * 0.004;

    /* 6. 悬停 */
    if (!dragging && state.viewIdx < 0 && pointer.x < 1.5 && state.cards.length) {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(state.cards.map((c) => c.mesh), false);
      const obj = hits.length ? hits[0].object : null;
      const nextCard = obj ? state.cards.find((c) => c.mesh === obj) : null;
      if (nextCard !== hovered) {
        hovered = nextCard || null;
        canvas.classList.toggle('hovering', !!hovered);
      }
    } else if (hovered) {
      hovered = null;
      canvas.classList.remove('hovering');
    }

    /* 7. 手势 HUD */
    if (handReady) {
      if (handLive && hs.fistHold > 0.55 && t - fistDone > 1.2 && state.viewIdx < 0) {
        fistDone = t;
        doGather();
      }
      updateHandHud(hs, handLive);
    } else if (handOn) {
      updateHandHud(hs || {}, false);
    }

    renderer.render(scene, camera);
  }

  /* ---------------- 启动 ---------------- */
  async function reload(reshuffle) {
    setLoader(true, '正在读取文件夹…');
    const items = await fetchManifest();
    if (reshuffle) items.sort(() => Math.random() - 0.5);
    state.items = items;

    if (!items.length) {
      setLoader(false);
      updateMediaInfo();
      showToast('没读到可用的照片，试试把文件放进 media 文件夹');
      return;
    }

    await buildCards(items, reshuffle);
    layout(true);
    setLoader(false);
    updateMediaInfo();
  }

  async function init() {
    applyText();
    buildSky();
    buildParticles();
    bindPanel();
    onResize();

    // 直接双击 index.html 打开时，浏览器会把 file:// 当成「不安全来源」，
    // 摄像头、视频、读目录全都不给用 —— 直接把原因写在屏幕上。
    if (location.protocol === 'file:') {
      $('#filemode').classList.add('on');
      $('#filemode-x').addEventListener('click', () => $('#filemode').classList.remove('on'));
    }

    await reload(false);

    if (/[?&]enter=1/.test(location.search)) {
      $('#intro').classList.add('hide');
      setTimeout(() => { $('#intro').style.display = 'none'; }, 900);
      setTimeout(() => { if (!handOn) toggleHand(); }, 900);
    }

    tick();
  }

  /* ---------------- 开场 ---------------- */
  $('#btn-enter').addEventListener('click', () => {
    $('#intro').classList.add('hide');
    setTimeout(() => { $('#intro').style.display = 'none'; }, 900);
    if (!bgm.getAttribute('src')) bgm.src = 'music/bgm.mp3';
    bgm.volume = CFG.vol / 100;
    bgm.play().then(() => {
      musicOn = true;
      $('#ico-music').textContent = '❙❙';
      $('#btn-music').classList.add('on');
    }).catch(() => { /* 没有音乐文件就算了 */ });
    setTimeout(() => { if (!handOn) toggleHand(); }, 700);
  });

  /* ---------------- 按钮 & 快捷键 ---------------- */
  $('#btn-gather').addEventListener('click', doGather);
  $('#btn-scatter').addEventListener('click', doScatter);
  $('#btn-prev').addEventListener('click', () => nextItem(-1));
  $('#btn-next').addEventListener('click', () => nextItem(1));

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key;
    if (k === 'Escape') {
      if (state.viewIdx >= 0) closeViewer();
      else if (panel.classList.contains('on')) togglePanel(false);
      return;
    }
    if (k === ' ') { e.preventDefault(); if (state.gather) doScatter(); else doGather(); }
    if (k === 'ArrowLeft') nextItem(-1);
    if (k === 'ArrowRight') nextItem(1);
    if (k.toLowerCase() === 'f') $('#btn-full').click();
    if (k.toLowerCase() === 'm') toggleMusic();
    if (k.toLowerCase() === 'h') toggleHand();
    if (k.toLowerCase() === 's') togglePanel(!panel.classList.contains('on'));
    if (k === '?') $('#btn-help').click();
  });

  window.__wall = {
    state, layout, doGather, doScatter, nextItem, openViewer, closeViewer, reload,
    CFG, P, LOOK, LOOK_T, sampleTextPts, HEART, TEXT, placeCard,
    renderer, camera, scene, world, getCamDist: () => camDist,
    showGestureCard,
    isCardOn: () => gcard.classList.contains('on'),
    setView: (t2, p2) => {
      theta = t2; phi = p2 === undefined ? phi : p2;
      thetaVel = phiVel = 0; lastUserT = 1e9;
    },
  };

  init();
})();

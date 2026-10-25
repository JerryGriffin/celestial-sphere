/* ============================================================
   天球 · 太阳的四季轨迹
   ------------------------------------------------------------
   坐标约定：n = 北, e = 东, z = 天顶   右手系，单位球 R = 1
   观测者位于球心；相机在球外观测，故球面近侧元素在画面外圈、
   远侧元素在画面内圈，形成透视纵深。
   ============================================================ */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  const EPS = 23.4393 * D2R;   // 黄赤交角 ε

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- 向量工具 ---------- */
  const V = {
    cross: (a, b) => ({
      n: a.e * b.z - a.z * b.e,
      e: a.z * b.n - a.n * b.z,
      z: a.n * b.e - a.e * b.n,
    }),
    dot: (a, b) => a.n * b.n + a.e * b.e + a.z * b.z,
    norm: (v) => {
      const L = Math.hypot(v.n, v.e, v.z) || 1;
      return { n: v.n / L, e: v.e / L, z: v.z / L };
    },
    scale: (v, k) => ({ n: v.n * k, e: v.e * k, z: v.z * k }),
    add: (a, b) => ({ n: a.n + b.n, e: a.e + b.e, z: a.z + b.z }),
    mix: (a, b, t) => ({
      n: a.n + (b.n - a.n) * t,
      e: a.e + (b.e - a.e) * t,
      z: a.z + (b.z - a.z) * t,
    }),
  };

  /* ---------- 天文计算 ----------
     赤道坐标 (δ, H) → 地平坐标：
       n = sinδ·cosφ − cosδ·sinφ·cosH
       e = −cosδ·sinH
       z = sinφ·sinδ + cosφ·cosδ·cosH
     H 为时角，自子午圈向西为正；地方太阳时 t 时 H = 15°(t−12)。
  ------------------------------------------------------------------ */
  function equatorialToHorizon(lat, dec, H) {
    const sp = Math.sin(lat), cp = Math.cos(lat);
    const sd = Math.sin(dec), cd = Math.cos(dec);
    const cH = Math.cos(H), sH = Math.sin(H);
    return {
      n: sd * cp - cd * sp * cH,
      e: -cd * sH,
      z: sp * sd + cp * cd * cH,
    };
  }

  /* 太阳黄经：以二分二至为控制点分段线性插值，
     保证四个节气节点精确、太阳恒落在黄道上 */
  const NODES = [[79, 0], [172, 90], [266, 180], [356, 270], [444, 360]];
  function sunLongitude(doy) {
    const n = doy < 79 ? doy + 365 : doy;
    for (let i = 0; i < NODES.length - 1; i++) {
      const a = NODES[i], b = NODES[i + 1];
      if (n >= a[0] && n <= b[0]) {
        return (a[1] + ((b[1] - a[1]) * (n - a[0])) / (b[0] - a[0])) * D2R;
      }
    }
    return 0;
  }
  function sunDeclination(doy) {
    return Math.asin(Math.sin(EPS) * Math.sin(sunLongitude(doy)));
  }

  /* 日出日落与昼长（几何地平 h = 0，忽略大气折射） */
  function dayStats(latDeg, dec) {
    const noonAlt = 90 - Math.abs(latDeg - dec * R2D);

    if (Math.abs(latDeg) > 89.9) {
      const h = dec * R2D * Math.sign(latDeg); // 极点处太阳高度恒等于 ±δ
      if (Math.abs(h) < 0.05) return { kind: 'edge', noonAlt, len: 24 };
      return h > 0
        ? { kind: 'polarday', noonAlt, len: 24 }
        : { kind: 'polarnight', noonAlt, len: 0 };
    }

    const lat = latDeg * D2R;
    const t = -Math.tan(lat) * Math.tan(dec);

    if (!isFinite(t) || t <= -1) return { kind: 'polarday', noonAlt, len: 24 };
    if (t >= 1) return { kind: 'polarnight', noonAlt, len: 0 };

    const H0 = Math.acos(t);
    return {
      kind: 'normal',
      noonAlt,
      rise: 12 - (H0 * 12) / Math.PI,
      set: 12 + (H0 * 12) / Math.PI,
      len: (H0 * 24) / Math.PI,
    };
  }

  const SEASONS = [
    { name: '春分', doy: 79, color: '#5ee8a8' },
    { name: '夏至', doy: 172, color: '#ff9f43' },
    { name: '秋分', doy: 266, color: '#ff7d92' },
    { name: '冬至', doy: 356, color: '#a78bfa' },
  ];

  /* 春分与秋分赤纬同为 0°，轨迹即天赤道本身，故不重复绘制，
     由天赤道承担此行语义（图例中已注明）—— 这本身就是待传达的几何事实 */
  const SEASON_PATHS = [
    { label: '夏至', doys: [172], color: '#ff9f43' },
    { label: '冬至', doys: [356], color: '#a78bfa' },
  ];

  /* ---------- 状态 ---------- */
  const S = {
    lat: 39.9,
    doy: 172,
    hour: 12,
    playing: false,
    speed: 2.0,          // 小时 / 秒
    showSeasons: true,
    showGrid: true,
    showEq: true,
    showEc: true,
    showMer: true,
    showAxis: true,
  };

  const CAM_DIST0 = 3.0;     // 默认视距，窄屏换算球体尺寸时作为基准
  const cam = {
    az: 172 * D2R,       // 相机所在方位（自北向东）
    el: 33 * D2R,        // 相机仰角：抬高俯视角，使地平圈呈可读的椭圆
    dist: CAM_DIST0,
    dir: null, pos: null, f: null, r: null, u: null,
  };

  /* ---------- 画布 ---------- */
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d', { alpha: false });

  // 视口尺寸统一用 VW/VH，避免与天文量 H（时角）同名遮蔽
  let VW = 0, VH = 0, DPR = 1, FOCAL = 1000, CX = 0, CY = 0, RSCREEN = 300;
  let bgCanvas = document.createElement('canvas');

  function buildBackdrop() {
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const g = bgCanvas.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);

    const grad = g.createRadialGradient(CX, CY * 0.82, 0, CX, CY, Math.max(VW, VH) * 0.85);
    grad.addColorStop(0, '#0d1730');
    grad.addColorStop(0.5, '#070c18');
    grad.addColorStop(1, '#03050b');
    g.fillStyle = grad;
    g.fillRect(0, 0, VW, VH);

    // 星点：固定种子，保证每次一致
    let seed = 20261025;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 200; i++) {
      const x = rnd() * VW;
      const y = rnd() * VH;
      const r = 0.25 + rnd() * 1.05;
      const a = 0.08 + rnd() * 0.42;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fillStyle = `rgba(207,226,255,${a.toFixed(3)})`;
      g.fill();
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    VW = window.innerWidth;
    VH = window.innerHeight;
    canvas.width = Math.round(VW * DPR);
    canvas.height = Math.round(VH * DPR);
    canvas.style.width = VW + 'px';
    canvas.style.height = VH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    CX = VW * 0.5;

    /* 球体尺寸由"实际可用空间"推导，而非固定比例：
       ≥1100px 左右双面板；820–1100 双窄面板；<820 底部抽屉。
       该断点必须与 styles.css 的媒体查询保持一致。 */
    const wide = VW >= 1100;
    const mid = VW >= 820;
    const sideW = wide ? 538 : (mid ? 446 : 0);
    const padX = mid ? 44 : 36;
    const availW = VW - sideW - padX;
    const availH = mid ? VH - 200 : VH * 0.42;
    const diam = Math.max(160, Math.min(availW, availH));

    FOCAL = (diam / 2) * Math.sqrt(CAM_DIST0 * CAM_DIST0 - 1);
    CY = mid ? VH * 0.5 + 8 : VH * 0.3;

    buildBackdrop();
    updateCam();
  }

  /* ---------- 相机与投影 ---------- */
  function updateCam() {
    const ce = Math.cos(cam.el), se = Math.sin(cam.el);
    cam.dir = { n: ce * Math.cos(cam.az), e: ce * Math.sin(cam.az), z: se };
    cam.pos = V.scale(cam.dir, cam.dist);
    cam.f = V.scale(cam.dir, -1);
    cam.r = V.norm(V.cross(cam.f, { n: 0, e: 0, z: 1 }));
    cam.u = V.cross(cam.r, cam.f);
    RSCREEN = FOCAL / Math.sqrt(cam.dist * cam.dist - 1);
  }

  function project(p) {
    const dn = p.n - cam.pos.n;
    const de = p.e - cam.pos.e;
    const dz = p.z - cam.pos.z;
    const depth = dn * cam.f.n + de * cam.f.e + dz * cam.f.z;
    if (depth < 0.05) return null;
    const sx = dn * cam.r.n + de * cam.r.e + dz * cam.r.z;
    const sy = dn * cam.u.n + de * cam.u.e + dz * cam.u.z;
    const k = FOCAL / depth;
    return { x: CX + sx * k, y: CY - sy * k };
  }

  /* ---------- 球面曲线绘制（按朝向定深度明暗） ---------- */
  const CURVE_BINS = 12;

  function drawCurve(pts, opt) {
    const N = pts.length;
    if (N < 2) return;

    const pr = new Array(N);
    for (let i = 0; i < N; i++) pr[i] = project(pts[i]);

    const bins = new Array(CURVE_BINS + 1);
    for (let i = 0; i <= CURVE_BINS; i++) bins[i] = [];
    let prev = -1;

    for (let i = 0; i < N - 1; i++) {
      const a = pr[i], b = pr[i + 1];
      if (!a || !b) { prev = -1; continue; }
      const mid = V.mix(pts[i], pts[i + 1], 0.5);
      const f = V.dot(mid, cam.dir);
      const tFace = clamp((f + 0.32) / 0.64, 0, 1);
      // 地平线以下的球面观测不到，额外压暗（仅对参考网格生效）
      const tHemi = opt.hemi ? clamp((mid.z + 0.1) / 0.2, 0.42, 1) : 1;
      const bi = Math.min(CURVE_BINS, ((tFace * tHemi) * CURVE_BINS) | 0);
      if (bi !== prev) { prev = bi; }
      bins[bi].push(a.x, a.y, b.x, b.y);
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (opt.glow) {
      ctx.shadowColor = opt.glowColor || opt.color;
      ctx.shadowBlur = opt.glow;
    }
    for (let i = 0; i <= CURVE_BINS; i++) {
      const arr = bins[i];
      if (!arr.length) continue;
      const k = i / CURVE_BINS;
      ctx.globalAlpha = clamp(lerp(opt.alphaBack, opt.alphaFront, k), 0, 1);
      ctx.strokeStyle = opt.color;
      ctx.lineWidth = opt.width;
      ctx.beginPath();
      for (let j = 0; j < arr.length; j += 4) {
        ctx.moveTo(arr[j], arr[j + 1]);
        ctx.lineTo(arr[j + 2], arr[j + 3]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 各类几何体 ---------- */
  function sunPath(lat, dec, steps) {
    const out = new Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      out[i] = equatorialToHorizon(lat, dec, (i / steps) * TAU);
    }
    return out;
  }

  function splitHorizon(pts) {
    const segs = [];
    if (!pts.length) return segs;
    let cur = [pts[0]];
    let sign = pts[0].z >= 0;
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i].z >= 0;
      if (s !== sign) {
        const p0 = pts[i - 1], p1 = pts[i];
        const t = p0.z === p1.z ? 0 : p0.z / (p0.z - p1.z);
        const x = V.mix(p0, p1, clamp(t, 0, 1));
        x.z = 0;
        cur.push(x);
        if (cur.length > 1) segs.push({ day: sign, pts: cur });
        cur = [x, pts[i]];
        sign = s;
      } else {
        cur.push(pts[i]);
      }
    }
    if (cur.length > 1) segs.push({ day: sign, pts: cur });
    return segs;
  }

  /* ---------- 绘制：球体 ---------- */
  function drawShell() {
    const g = ctx.createRadialGradient(CX, CY, RSCREEN * 0.1, CX, CY, RSCREEN);
    g.addColorStop(0, 'rgba(76,122,198,.045)');
    g.addColorStop(0.6, 'rgba(52,92,160,.038)');
    g.addColorStop(0.9, 'rgba(98,152,232,.10)');
    g.addColorStop(1, 'rgba(152,202,255,.22)');
    ctx.beginPath();
    ctx.arc(CX, CY, RSCREEN, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,198,255,.3)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /* ---------- 绘制：地平盘 ---------- */
  function drawHorizonDisc() {
    const steps = 120;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU;
      const p = project({ n: Math.cos(a), e: Math.sin(a), z: 0 });
      if (p) pts.push(p);
    }
    if (pts.length < 3) return;

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    const g = ctx.createRadialGradient(CX, CY, 0, CX, CY, RSCREEN);
    g.addColorStop(0, 'rgba(40,64,102,.56)');
    g.addColorStop(0.68, 'rgba(26,46,78,.46)');
    g.addColorStop(1, 'rgba(16,30,52,.2)');
    ctx.fillStyle = g;
    ctx.fill();
  }

  /* ---------- 绘制：地平坐标网格 ---------- */
  function drawGrid() {
    const style = {
      color: 'rgba(126,168,224,1)',
      width: 0.9,
      alphaFront: 0.21,
      alphaBack: 0.04,
      hemi: true,
    };

    // 等高圈
    for (const deg of [-60, -30, 30, 60]) {
      const alt = deg * D2R, ca = Math.cos(alt), sa = Math.sin(alt);
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * TAU;
        pts.push({ n: ca * Math.cos(a), e: ca * Math.sin(a), z: sa });
      }
      drawCurve(pts, style);
    }

    // 方位垂直圈（半大圆，子午圈单独绘制）
    for (let az = 30; az < 360; az += 30) {
      const a = az * D2R, ca = Math.cos(a), sa = Math.sin(a);
      const pts = [];
      for (let i = 0; i <= 54; i++) {
        const alt = (-90 + (i / 54) * 180) * D2R;
        const r = Math.cos(alt);
        pts.push({ n: r * ca, e: r * sa, z: Math.sin(alt) });
      }
      drawCurve(pts, style);
    }
  }

  /* ---------- 绘制：子午圈 ---------- */
  function drawMeridian() {
    const pts = [];
    for (let i = 0; i <= 180; i++) {
      const alt = (-90 + (i / 180) * 360) * D2R;
      pts.push({ n: Math.cos(alt), e: 0, z: Math.sin(alt) });
    }
    drawCurve(pts, {
      color: 'rgba(158,186,224,1)',
      width: 1.05,
      alphaFront: 0.22,
      alphaBack: 0.05,
      hemi: true,
    });
  }

  /* ---------- 绘制：天赤道 ---------- */
  function drawEquator(lat) {
    drawCurve(sunPath(lat, 0, 180), {
      color: 'rgba(74,134,232,1)',
      width: 1.4,
      alphaFront: 0.52,
      alphaBack: 0.13,
    });
  }

  /* ---------- 绘制：黄道 ---------- */
  function drawEcliptic(lat, doy, hour) {
    const dec = sunDeclination(doy);
    const lam = sunLongitude(doy);
    // 太阳赤经，用于反推春分点时角
    const alpha = Math.atan2(Math.sin(lam) * Math.cos(EPS), Math.cos(lam));
    const Hx = (hour - 12) * 15 * D2R + alpha;

    const X = equatorialToHorizon(lat, 0, Hx);                  // 春分点
    const Y = equatorialToHorizon(lat, 0, Hx - Math.PI / 2);    // α = 90°
    const P = { n: Math.cos(lat), e: 0, z: Math.sin(lat) };     // 北天极
    const A = V.norm(V.add(V.scale(Y, Math.cos(EPS)), V.scale(P, Math.sin(EPS))));

    const pts = [];
    for (let i = 0; i <= 180; i++) {
      const t = (i / 180) * TAU;
      pts.push(V.norm(V.add(V.scale(X, Math.cos(t)), V.scale(A, Math.sin(t)))));
    }
    drawCurve(pts, {
      // 橙红参考线：与当日轨迹的亮金刻意拉开色相与权重
      color: 'rgba(244,150,86,1)',
      width: 1.15,
      alphaFront: 0.42,
      alphaBack: 0.1,
    });
  }

  /* ---------- 绘制：天轴与天极 ---------- */
  function drawAxis(lat) {
    const P = { n: Math.cos(lat), e: 0, z: Math.sin(lat) };
    const a = project(V.scale(P, -1));
    const b = project(P);

    if (a && b) {
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(140,180,240,.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    const pn = project(P);
    if (pn) {
      ctx.beginPath();
      ctx.arc(pn.x, pn.y, 3, 0, TAU);
      ctx.fillStyle = 'rgba(186,214,255,.85)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pn.x, pn.y, 6.5, 0, TAU);
      ctx.strokeStyle = 'rgba(186,214,255,.28)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = '10px ui-monospace,SFMono-Regular,Menlo,monospace';
      ctx.fillStyle = 'rgba(176,204,244,.72)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', pn.x + 9, pn.y - 8);
    }
  }

  /* ---------- 绘制：地平圈 ---------- */
  function drawHorizonRing() {
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU;
      pts.push({ n: Math.cos(a), e: Math.sin(a), z: 0 });
    }
    drawCurve(pts, {
      // 最亮的一圈：地平面是全部读数的基准，用亮度而非色相与天赤道区分
      color: 'rgba(170,240,255,1)',
      width: 2.0,
      alphaFront: 0.9,
      alphaBack: 0.36,
      glow: 8,
      glowColor: 'rgba(102,217,255,.55)',
    });
  }

  /* ---------- 绘制：太阳轨迹 ---------- */
  function drawPaths(lat, dec) {
    if (S.showSeasons) {
      for (const sp of SEASON_PATHS) {
        if (sp.doys.some((d) => Math.abs(S.doy - d) <= 1)) continue;
        const d = sunDeclination(sp.doys[0]);
        const segs = splitHorizon(sunPath(lat, d, 140));
        for (const seg of segs) {
          if (!seg.day) continue;
          drawCurve(seg.pts, {
            color: sp.color,
            width: 1.7,
            alphaFront: 0.68,
            alphaBack: 0.13,
          });
        }
      }
    }

    const segs = splitHorizon(sunPath(lat, dec, 240));
    for (const seg of segs) {
      if (seg.day) {
        drawCurve(seg.pts, {
          color: '#ffd24a',
          width: 2.6,
          alphaFront: 1,
          alphaBack: 0.32,
          glow: 12,
          glowColor: 'rgba(255,180,60,.6)',
        });
      } else {
        drawCurve(seg.pts, {
          color: 'rgba(150,170,200,1)',
          width: 1.15,
          alphaFront: 0.34,
          alphaBack: 0.08,
        });
      }
    }

    // 昼夜分界点（日出 / 日落）
    const seen = new Set();
    for (const seg of segs) {
      for (const p of [seg.pts[0], seg.pts[seg.pts.length - 1]]) {
        if (Math.abs(p.z) > 1e-7) continue;
        const key = p.n.toFixed(4) + ',' + p.e.toFixed(4);
        if (seen.has(key)) continue;
        seen.add(key);
        const q = project(p);
        if (!q) continue;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 2.6, 0, TAU);
        ctx.fillStyle = 'rgba(255,214,120,.95)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6, 0, TAU);
        ctx.strokeStyle = 'rgba(255,205,100,.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  /* ---------- 绘制：太阳 ---------- */
  function drawSun(v, alt) {
    const p = project(v);
    if (!p) return;

    const above = alt > 0;
    const R = Math.min(VW, VH) * 0.072;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    if (above) {
      g.addColorStop(0, 'rgba(255,246,214,1)');
      g.addColorStop(0.07, 'rgba(255,222,142,.78)');
      g.addColorStop(0.2, 'rgba(255,186,72,.26)');
      g.addColorStop(0.48, 'rgba(255,158,44,.09)');
      g.addColorStop(1, 'rgba(255,140,30,0)');
    } else {
      g.addColorStop(0, 'rgba(176,190,222,.3)');
      g.addColorStop(0.3, 'rgba(136,158,208,.07)');
      g.addColorStop(1, 'rgba(120,140,200,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(p.x, p.y, above ? 6.4 : 5.1, 0, TAU);
    ctx.fillStyle = above ? '#fff7dc' : 'rgba(172,192,226,.6)';
    ctx.fill();

    if (above) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9.6, 0, TAU);
      ctx.strokeStyle = 'rgba(255,206,104,.34)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  /* ---------- 绘制：太阳的地面投影辅助线 ---------- */
  function drawSunDrop(v) {
    if (Math.hypot(v.n, v.e) < 1e-4) return;
    const foot = { n: v.n, e: v.e, z: 0 };
    const a = project(v), b = project(foot);
    if (!a || !b) return;

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,200,100,.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(b.x, b.y, 2.1, 0, TAU);
    ctx.fillStyle = 'rgba(255,200,100,.45)';
    ctx.fill();
  }

  /* ---------- 绘制：方位与天顶标注 ---------- */
  function drawLabels() {
    const items = [
      { d: { n: 1, e: 0, z: 0 }, t: '北' },
      { d: { n: 0, e: 1, z: 0 }, t: '东' },
      { d: { n: -1, e: 0, z: 0 }, t: '南' },
      { d: { n: 0, e: -1, z: 0 }, t: '西' },
    ];

    ctx.save();
    ctx.font = '600 13px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 深色描边光晕：保证标签压在线条之上仍可读
    ctx.shadowColor = 'rgba(5,8,16,.95)';
    ctx.shadowBlur = 6;

    for (const it of items) {
      const facing = V.dot(it.d, cam.dir);
      const p = project(V.scale(it.d, 1.045));
      if (!p) continue;
      ctx.globalAlpha = 0.2 + 0.72 * clamp((facing + 0.25) / 0.6, 0, 1);
      ctx.fillStyle = '#9ec4ec';
      ctx.fillText(it.t, p.x, p.y);
    }

    // 天顶
    const zf = V.dot({ n: 0, e: 0, z: 1 }, cam.dir);
    const zp = project({ n: 0, e: 0, z: 1 });
    if (zp) {
      const a = 0.18 + 0.68 * clamp((zf + 0.25) / 0.6, 0, 1);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#a9cbee';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(zp.x - 5, zp.y);
      ctx.lineTo(zp.x + 5, zp.y);
      ctx.moveTo(zp.x, zp.y - 5);
      ctx.lineTo(zp.x, zp.y + 5);
      ctx.stroke();

      ctx.globalAlpha = a * 0.85;
      ctx.font = '11px ui-monospace,SFMono-Regular,Menlo,monospace';
      ctx.fillStyle = '#a9cbee';
      ctx.textAlign = 'left';
      ctx.fillText('Z', zp.x + 9, zp.y - 9);
    }
    ctx.restore();
  }

  /* ---------- 主绘制 ---------- */
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.drawImage(bgCanvas, 0, 0, VW, VH);

    const lat = S.lat * D2R;
    const dec = sunDeclination(S.doy);
    const hourAngle = (S.hour - 12) * 15 * D2R;
    const v = equatorialToHorizon(lat, dec, hourAngle);
    const alt = Math.asin(clamp(v.z, -1, 1)) * R2D;

    updateCam();

    drawShell();
    drawHorizonDisc();
    if (S.showGrid) drawGrid();
    if (S.showMer) drawMeridian();
    if (S.showEq) drawEquator(lat);
    if (S.showEc) drawEcliptic(lat, S.doy, S.hour);
    if (S.showAxis) drawAxis(lat);
    drawHorizonRing();

    drawPaths(lat, dec);
    drawSunDrop(v);
    drawSun(v, alt);
    drawLabels();
  }

  /* ---------- 数值展示 ---------- */
  const el = (id) => document.getElementById(id);
  const ui = {
    sub: el('subline'),
    lat: el('lat'), latOut: el('latOut'),
    doy: el('doy'), doyOut: el('doyOut'),
    hour: el('hour'), hourOut: el('hourOut'),
    play: el('play'),
    oDec: el('oDec'), oAlt: el('oAlt'), oAz: el('oAz'), oHa: el('oHa'),
    oRise: el('oRise'), oSet: el('oSet'), oLen: el('oLen'), oNoon: el('oNoon'),
    oStatus: el('oStatus'), noonGrid: el('noonGrid'),
    legend: el('legend'),
  };

  function renderLegend() {
    const rows = [
      { head: '太阳轨迹' },
      { t: '当日太阳轨迹', c: '#ffd24a', w: 3 },
      { t: '夏至', c: '#ff9f43', w: 2 },
      { t: '冬至', c: '#a78bfa', w: 2 },
      { sep: true },
      { head: '参考圆' },
      { t: '天赤道 ＝ 春分·秋分轨迹', c: '#4a86e8', w: 2 },
      { t: '黄道', c: '#f49656', w: 2 },
      { t: '地平圈', c: '#6ee7ff', w: 2 },
    ];
    ui.legend.innerHTML = rows
      .map((r) => {
        if (r.head) return `<div class="noon__title">${r.head}</div>`;
        if (r.sep) return '<div class="legend__sep"></div>';
        return `<div class="legend__row"><i class="legend__bar" style="background:${r.c};height:${r.w}px"></i><span>${r.t}</span></div>`;
      })
      .join('');
  }

  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  function fmtDate(doy) {
    let n = doy, m = 0;
    while (m < 12 && n > MONTH_DAYS[m]) { n -= MONTH_DAYS[m]; m++; }
    return `${m + 1}月${n}日`;
  }
  function jieqi(doy) {
    const map = { 79: '春分', 172: '夏至', 266: '秋分', 356: '冬至' };
    for (const k in map) if (Math.abs(doy - Number(k)) <= 1) return map[k];
    return '';
  }
  function fmtHour(h) {
    h = ((h % 24) + 24) % 24;
    let hh = Math.floor(h);
    let mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }
  function fmtLat(v) {
    if (Math.abs(v) < 0.05) return '0.0°';
    return Math.abs(v).toFixed(1) + '° ' + (v > 0 ? 'N' : 'S');
  }
  function fmtDeg(v, signed) {
    const s = signed && v > 0.05 ? '+' : '';
    return s + v.toFixed(1) + '°';
  }
  function fmtLen(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  function renderNoonTable() {
    let html = '';
    for (const s of SEASONS) {
      const d = sunDeclination(s.doy);
      const a = 90 - Math.abs(S.lat - d * R2D);
      // 以日期判断当前季节（跨年取环形最短距离），赤纬在春分/秋分同为 0 无法区分
      const gap = Math.abs(S.doy - s.doy);
      const now = Math.min(gap, 365 - gap) <= 3 ? ' is-now' : '';
      const txt = a >= 0 ? a.toFixed(1) + '°' : '—';
      html += `<div class="noon__item${now}"><span>${s.name}</span><b>${txt}</b></div>`;
    }
    ui.noonGrid.innerHTML = html;
  }

  function updateReadouts() {
    const lat = S.lat * D2R;
    const dec = sunDeclination(S.doy);
    const hourAngle = (S.hour - 12) * 15 * D2R;
    const v = equatorialToHorizon(lat, dec, hourAngle);
    const alt = Math.asin(clamp(v.z, -1, 1)) * R2D;
    const az = (Math.atan2(v.e, v.n) * R2D + 360) % 360;
    const st = dayStats(S.lat, dec);
    const jq = jieqi(S.doy);

    ui.latOut.textContent = fmtLat(S.lat);
    ui.doyOut.textContent = fmtDate(S.doy) + (jq ? ' · ' + jq : '');
    ui.hourOut.textContent = fmtHour(S.hour);
    ui.sub.textContent =
      `${fmtLat(S.lat)} · ${fmtDate(S.doy)}${jq ? ' ' + jq : ''} · ${fmtHour(S.hour)} 地方太阳时`;

    ui.oDec.textContent = fmtDeg(dec * R2D, true);
    ui.oAlt.textContent = fmtDeg(alt, false);
    // 正过天顶/天底时方位角无定义，直接置空以免出现浮点噪声
    ui.oAz.textContent = Math.abs(alt) > 89.85 ? '—' : az.toFixed(1) + '°';
    ui.oHa.textContent = fmtDeg(((hourAngle * R2D + 540) % 360) - 180, true);

    ui.oNoon.textContent = st.noonAlt > 0 ? st.noonAlt.toFixed(1) + '°' : '地平以下';

    if (st.kind === 'normal') {
      ui.oRise.textContent = fmtHour(st.rise);
      ui.oSet.textContent = fmtHour(st.set);
      ui.oLen.textContent = fmtLen(st.len);
    } else if (st.kind === 'polarday') {
      ui.oRise.textContent = '—';
      ui.oSet.textContent = '—';
      ui.oLen.textContent = '24h 00m';
    } else {
      ui.oRise.textContent = '—';
      ui.oSet.textContent = '—';
      ui.oLen.textContent = '0h 00m';
    }

    let msg, night = false;
    if (st.kind === 'polarday') {
      msg = '极昼 · 太阳全天不落';
    } else if (st.kind === 'polarnight') {
      msg = '极夜 · 太阳全天不升';
      night = true;
    } else if (st.kind === 'edge') {
      msg = '太阳沿地平圈环绕';
    } else if (alt > 89.85) {
      msg = '太阳正过天顶 · 高度 90°';
    } else if (alt > 0) {
      msg = '太阳位于地平线以上';
    } else {
      msg = '太阳位于地平线以下';
      night = true;
    }
    ui.oStatus.textContent = msg;
    ui.oStatus.classList.toggle('is-night', night);

    renderNoonTable();
    syncChips();
  }

  function syncChips() {
    document.querySelectorAll('.chips[data-group="lat"] button').forEach((b) => {
      b.classList.toggle('is-on', Math.abs(Number(b.dataset.val) - S.lat) < 0.01);
    });
    document.querySelectorAll('.chips[data-group="doy"] button').forEach((b) => {
      b.classList.toggle('is-on', Math.abs(Number(b.dataset.val) - S.doy) < 0.6);
    });
  }

  /* ---------- 交互 ---------- */
  function bind() {
    ui.lat.addEventListener('input', () => {
      S.lat = Number(ui.lat.value);
      updateReadouts();
    });

    ui.doy.addEventListener('input', () => {
      S.doy = Number(ui.doy.value);
      updateReadouts();
    });

    ui.hour.addEventListener('input', () => {
      if (S.playing) setPlaying(false);
      S.hour = Number(ui.hour.value);
      updateReadouts();
    });

    document.querySelectorAll('.chips[data-group="lat"] button').forEach((b) => {
      b.addEventListener('click', () => {
        S.lat = Number(b.dataset.val);
        ui.lat.value = S.lat;
        updateReadouts();
      });
    });

    document.querySelectorAll('.chips[data-group="doy"] button').forEach((b) => {
      b.addEventListener('click', () => {
        S.doy = Number(b.dataset.val);
        ui.doy.value = S.doy;
        updateReadouts();
      });
    });

    const toggles = [
      ['optSeasons', 'showSeasons'],
      ['optGrid', 'showGrid'],
      ['optEq', 'showEq'],
      ['optEc', 'showEc'],
      ['optMer', 'showMer'],
      ['optAxis', 'showAxis'],
    ];
    for (const [id, key] of toggles) {
      const n = el(id);
      n.addEventListener('change', () => { S[key] = n.checked; });
    }

    ui.play.addEventListener('click', () => setPlaying(!S.playing));

    // 拖拽旋转
    let drag = false, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      drag = true; lx = e.clientX; ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      cam.az -= (e.clientX - lx) * 0.0062;
      cam.el = clamp(cam.el + (e.clientY - ly) * 0.0048, -85 * D2R, 85 * D2R);
      lx = e.clientX; ly = e.clientY;
    });
    const stop = (e) => {
      drag = false;
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0009), 2.1, 6.5);
    }, { passive: false });

    // 键盘：左右箭头调时间
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (S.playing) setPlaying(false);
        S.hour = (S.hour + (e.key === 'ArrowRight' ? 0.25 : -0.25) + 24) % 24;
        ui.hour.value = S.hour;
        updateReadouts();
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying(!S.playing);
      }
    });

    window.addEventListener('resize', resize);
  }

  function setPlaying(on) {
    S.playing = on;
    ui.play.classList.toggle('is-playing', on);
  }

  /* ---------- 主循环 ---------- */
  let lastT = 0;
  function loop(t) {
    const dt = lastT ? Math.min((t - lastT) / 1000, 0.12) : 0;
    lastT = t;

    if (S.playing) {
      S.hour = (S.hour + dt * S.speed) % 24;
      ui.hour.value = S.hour;
      updateReadouts();
    }

    draw();
    requestAnimationFrame(loop);
  }

  /* ---------- 启动 ---------- */
  resize();
  bind();
  renderLegend();
  updateReadouts();
  requestAnimationFrame(loop);
})();

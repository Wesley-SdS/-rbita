"use client";

import { useEffect, useRef } from "react";

export type OrbMode =
  | "standby"
  | "listening"
  | "speaking"
  | "searching"
  | "studying"
  | "connecting";

/** Núcleo neural ÓRBITA (estilo Jarvis) — portado do design/protótipo. */
export function Orb({
  mode = "standby",
  height = 380,
  fill = false,
  bare = false,
}: {
  mode?: OrbMode;
  height?: number;
  fill?: boolean;
  bare?: boolean;
}) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<OrbMode>(mode);
  modeRef.current = mode;

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, DPR = 1;
    const size = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    const ro = new ResizeObserver(size);
    ro.observe(cv);
    size();

    // ── geometria ──
    const _gr = Math.PI * (3 - Math.sqrt(5)), JN = 150;
    const jn: { x: number; y: number; z: number; big: boolean; ph: number }[] = [];
    for (let i = 0; i < JN; i++) {
      const y = 1 - (i / (JN - 1)) * 2, r = Math.sqrt(1 - y * y), th = _gr * i;
      jn.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, big: Math.random() < 0.16, ph: Math.random() * 6.2832 });
    }
    const je: { a: number; b: number; d: number }[] = [];
    const _THR = 0.32;
    for (let i = 0; i < JN; i++)
      for (let j = i + 1; j < JN; j++) {
        const dx = jn[i].x - jn[j].x, dy = jn[i].y - jn[j].y, dz = jn[i].z - jn[j].z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < _THR) je.push({ a: i, b: j, d });
      }
    const orbits = [
      { ax: 0, ay: 0.9, rr: 1.3, rz: 0.55, spd: 0.5 },
      { ax: 0.7, ay: 0.2, rr: 1.42, rz: 0.42, spd: -0.35 },
      { ax: -0.5, ay: 0.5, rr: 1.18, rz: 0.62, spd: 0.62 },
    ];
    const CFG: Record<OrbMode, { rot: number; energy: number }> = {
      standby: { rot: 0.11, energy: 0.25 },
      listening: { rot: 0.16, energy: 0.7 },
      speaking: { rot: 0.2, energy: 1 },
      searching: { rot: 0.55, energy: 0.9 },
      studying: { rot: 0.24, energy: 0.85 },
      connecting: { rot: 0.3, energy: 0.95 },
    };

    let energy = 0.25, angY = 0, angX = -0.32, coreAng = 0, jt = 0, spawnAcc = 0, beatEnv = 0, nextBeat = 0, lastT = 0;
    const speakAmp = 0; // futuro: dirigido pela voz (TTS)
    let packets: { e: number; t: number; sp: number }[] = [];
    let ripples: { r: number }[] = [];
    let rings: { r: number; a: number }[] = [];

    const jrot = (p: { x: number; y: number; z: number }) => {
      const cyy = Math.cos(angY), syy = Math.sin(angY);
      const x = p.x * cyy + p.z * syy, z = -p.x * syy + p.z * cyy;
      const cxx = Math.cos(angX), sxx = Math.sin(angX);
      return { x, y: p.y * cxx - z * sxx, z: p.y * sxx + z * cxx };
    };
    const jproj = (p: { x: number; y: number; z: number }, R: number, cx: number, cy: number) => {
      const s = 3.2 / (3.2 - p.z);
      return { px: cx + p.x * s * R, py: cy + p.y * s * R, s, depth: (p.z + 1) / 2 };
    };

    let raf = 0;
    const draw = (now?: number) => {
      const dt = Math.min(((now || 0) - lastT) / 1000, 0.05) || 0.016;
      lastT = now || 0;
      const mode = modeRef.current;
      const cfg = CFG[mode] || CFG.standby;
      jt += dt;
      energy += (cfg.energy - energy) * Math.min(dt * 4, 1);
      const E = energy;
      angY += dt * cfg.rot;
      angX = -0.32 + Math.sin(jt * 0.15) * 0.06;
      coreAng += dt * (0.6 + (mode === "speaking" ? 1.4 : 0) + (mode === "searching" ? 1.2 : 0)) * (0.6 + E);
      nextBeat -= dt;
      if (nextBeat <= 0) {
        beatEnv = 1;
        nextBeat = mode === "speaking" ? 0.12 + Math.random() * 0.22 : 0.5 + Math.random() * 0.6;
      }
      beatEnv *= Math.pow(0.02, dt);
      if (speakAmp > beatEnv) beatEnv = speakAmp;

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(10,7,3,0.34)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      const cx = W / 2, cy = H * 0.46, R = Math.min(W, H) * 0.3;
      const P = jn.map((n) => jproj(jrot(n), R, cx, cy));

      for (const e of je) {
        const a = P[e.a], b = P[e.b], depth = (a.depth + b.depth) / 2;
        let al = 0.05 + depth * 0.16;
        if (mode === "studying") al += 0.1 * Math.max(0, Math.sin(jt * 2 + e.a * 0.3)) * E;
        if (mode === "connecting") al += 0.06 * E;
        ctx.strokeStyle = "rgba(255,168,74," + al.toFixed(3) + ")";
        ctx.lineWidth = 0.6 + depth * 0.5;
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
      }

      let sweepA = 0;
      if (mode === "searching") {
        sweepA = (jt * 2.2) % 6.2832;
        const gx = Math.cos(sweepA), gy = Math.sin(sweepA);
        const grad = ctx.createLinearGradient(cx - gx * R, cy - gy * R, cx + gx * R, cy + gy * R);
        grad.addColorStop(0, "rgba(255,170,60,0)");
        grad.addColorStop(0.5, "rgba(255,200,110," + 0.28 * E + ")");
        grad.addColorStop(1, "rgba(255,170,60,0)");
        ctx.strokeStyle = grad; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx - gx * R * 1.3, cy - gy * R * 1.3); ctx.lineTo(cx + gx * R * 1.3, cy + gy * R * 1.3); ctx.stroke();
      }

      for (let i = 0; i < jn.length; i++) {
        const n = jn[i], p = P[i];
        let br = 0.35 + p.depth * 0.5, sz = (n.big ? 2.4 : 1.3) * (0.55 + p.depth * 0.6);
        br += 0.25 * Math.sin(jt * 1.6 + n.ph);
        const ang2d = Math.atan2(p.py - cy, p.px - cx), dist2d = Math.hypot(p.px - cx, p.py - cy) / R;
        if (mode === "searching") {
          let da = Math.abs(((ang2d - sweepA + 9.4248) % 6.2832) - 3.1416);
          da = Math.min(da, Math.abs(((ang2d - sweepA + 12.5664) % 6.2832) - 3.1416));
          if (da < 0.35) { br += (1 - da / 0.35) * 1.4 * E; sz *= 1 + (1 - da / 0.35) * 1.1 * E; }
        }
        if (mode === "studying") { const f = Math.sin(jt * 3 - i * 0.4); if (f > 0.85) { br += (f - 0.85) * 8 * E; sz *= 1.5; } }
        for (const rp of ripples) { const d = Math.abs(dist2d - rp.r); if (d < 0.09) { br += (1 - d / 0.09) * 1.6 * E; sz *= 1 + (1 - d / 0.09) * 0.9; } }
        if (mode === "speaking" || mode === "listening") br += beatEnv * 0.4 * E;
        br = Math.max(0, Math.min(2.2, br));
        const col = n.big ? "255,215,150" : "255,180,90";
        const g = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, sz * 5);
        g.addColorStop(0, "rgba(" + col + "," + (0.5 * br).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + col + ",0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.px, p.py, sz * 5, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "rgba(255,236,205," + Math.min(1, 0.6 * br + 0.2).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.px, p.py, sz, 0, 6.2832); ctx.fill();
      }

      for (const o of orbits) {
        ctx.strokeStyle = "rgba(255,190,90," + (0.22 + 0.15 * E).toFixed(3) + ")";
        ctx.lineWidth = 1.4; ctx.beginPath();
        const spin = jt * o.spd;
        for (let a = 0; a <= 64; a++) {
          const th = (a / 64) * 6.2832;
          const ex = Math.cos(th) * o.rr, ey = Math.sin(th) * o.rz;
          const x1 = ex * Math.cos(spin) - ey * Math.sin(spin), y1 = ex * Math.sin(spin) + ey * Math.cos(spin);
          const y2 = y1 * Math.cos(o.ax), z2 = y1 * Math.sin(o.ax);
          const x3 = x1 * Math.cos(o.ay) + z2 * Math.sin(o.ay), z3 = -x1 * Math.sin(o.ay) + z2 * Math.cos(o.ay);
          const pp = jproj(jrot({ x: x3, y: y2, z: z3 }), R, cx, cy);
          a ? ctx.lineTo(pp.px, pp.py) : ctx.moveTo(pp.px, pp.py);
        }
        ctx.stroke();
      }

      if (mode === "listening") { spawnAcc += dt; if (spawnAcc > 0.5) { spawnAcc = 0; rings.push({ r: 0.12, a: 0.5 }); } }
      for (let i = rings.length - 1; i >= 0; i--) {
        const rg = rings[i]; rg.r += dt * 0.5; rg.a -= dt * 0.4;
        if (rg.a <= 0) { rings.splice(i, 1); continue; }
        ctx.strokeStyle = "rgba(150,210,255," + (rg.a * E).toFixed(3) + ")";
        ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, rg.r * R * 1.4, 0, 6.2832); ctx.stroke();
      }

      if (mode === "connecting") { spawnAcc += dt; if (spawnAcc > 0.9) { spawnAcc = 0; ripples.push({ r: 0.05 }); } }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]; rp.r += dt * 0.9;
        if (rp.r > 1.25) { ripples.splice(i, 1); continue; }
        const a = Math.max(0, 1 - rp.r / 1.25) * 0.6 * Math.max(E, 0.4);
        ctx.strokeStyle = "rgba(255,150,80," + a.toFixed(3) + ")";
        ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, rp.r * R, 0, 6.2832); ctx.stroke();
      }

      if (mode === "studying") { spawnAcc += dt; if (spawnAcc > 0.06 && packets.length < 70) { spawnAcc = 0; packets.push({ e: (Math.random() * je.length) | 0, t: 0, sp: 0.8 + Math.random() * 1.2 }); } }
      for (let i = packets.length - 1; i >= 0; i--) {
        const pk = packets[i]; pk.t += dt * pk.sp;
        if (pk.t >= 1) { packets.splice(i, 1); continue; }
        const e = je[pk.e], a = P[e.a], b = P[e.b], x = a.px + (b.px - a.px) * pk.t, y = a.py + (b.py - a.py) * pk.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
        g.addColorStop(0, "rgba(180,255,160,0.9)"); g.addColorStop(1, "rgba(160,255,140,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.2832); ctx.fill();
      }

      const beat = mode === "speaking" ? beatEnv : 0;
      const coreR = R * (0.2 + 0.03 * Math.sin(jt * 2) + beat * 0.06);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.4);
      const ci = 0.55 + 0.35 * E + beat * 0.4;
      cg.addColorStop(0, "rgba(255,244,220," + Math.min(1, ci).toFixed(3) + ")");
      cg.addColorStop(0.25, "rgba(255,190,90," + (0.7 * ci).toFixed(3) + ")");
      cg.addColorStop(0.6, "rgba(255,140,50," + (0.25 * ci).toFixed(3) + ")");
      cg.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, coreR * 3.4, 0, 6.2832); ctx.fill();

      for (let arm = 0; arm < 3; arm++) {
        const off = (arm / 3) * 6.2832;
        for (let s = 0; s < 90; s++) {
          const tt = s / 90, th = tt * 2.4 * 6.2832 + off + coreAng, rad = tt * coreR * 1.35;
          const x = cx + Math.cos(th) * rad, y = cy + Math.sin(th) * rad * 0.9, br = (1 - tt) * 0.9, sz = (1 - tt) * 2.4 + 0.4;
          ctx.fillStyle = "rgba(255," + (200 - tt * 40) + "," + (150 - tt * 70) + "," + br.toFixed(3) + ")";
          ctx.beginPath(); ctx.arc(x, y, sz, 0, 6.2832); ctx.fill();
        }
      }

      if (mode === "speaking" || mode === "listening") {
        const base = coreR * 1.7, ampl = (mode === "speaking" ? 0.55 : 0.3) * R * 0.18 * E;
        ctx.strokeStyle = mode === "speaking" ? "rgba(255,205,120," + 0.6 * E + ")" : "rgba(150,210,255," + 0.55 * E + ")";
        ctx.lineWidth = 2; ctx.beginPath();
        for (let a = 0; a <= 90; a++) {
          const th = (a / 90) * 6.2832;
          const m = Math.sin(th * 6 + jt * 8) * 0.5 + Math.sin(th * 11 - jt * 5) * 0.3 + Math.sin(th * 3 + jt * 3) * 0.2;
          const rad = base + m * ampl * (0.5 + beatEnv);
          const x = cx + Math.cos(th) * rad, y = cy + Math.sin(th) * rad;
          a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
      }

      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const canvasStyle: React.CSSProperties = fill
    ? { width: "100%", height: "100%", display: "block" }
    : { width: "100%", height, display: "block" };

  if (bare) return <canvas ref={cvRef} aria-hidden style={canvasStyle} />;

  return (
    <div
      style={{
        background: "radial-gradient(circle at 50% 46%, #1a1206 0%, #0d0904 55%, #0a0703 100%)",
        borderRadius: 16,
        height: fill ? "100%" : undefined,
      }}
    >
      <canvas ref={cvRef} aria-hidden style={canvasStyle} />
    </div>
  );
}

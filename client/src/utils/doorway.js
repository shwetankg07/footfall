// The landing hero: people crossing a dark floor into one tall, lit doorway.
// Plain canvas 2D. World units are metres: x runs across, z runs away from the viewer and
// the floor is y = 0. The doorway is drawn wherever the page lays out its slot element, so
// CSS owns the composition and this file only paints it. The camera height is solved from
// that layout so walkers never grow past about half the door, however the page is sized.

const PERSON = 1.7;
const DOOR_Z = 10;
const DOOR_H = 7.7; // a tall gate: people reach about a fifth of the way up
const DOOR_W = DOOR_H / 2.2; // the slot's CSS aspect ratio must match: 1 / 2.2
const SPREAD = 0.28; // how fast the spill of light widens toward the viewer
const AVOID = 2.4; // how far walkers keep from the pointer, in metres
const FADE = 1.1; // metres past the threshold over which a walker fades into the light

const rand = (a, b) => a + Math.random() * (b - a);

export function startDoorway(canvas, slot, { reduced = false, onEnter } = {}) {
  const ctx = canvas.getContext("2d");
  const backdrop = document.createElement("canvas");
  const bctx = backdrop.getContext("2d");
  // Walkers go on their own layer so the walk-in can fade them as one image.
  const layer = document.createElement("canvas");
  const lctx = layer.getContext("2d");
  const scratch = document.createElement("canvas");
  const sctx = scratch.getContext("2d");
  // Tweened from outside: power fades the light in, enter walks the camera toward the door.
  const state = { power: reduced ? 1 : 0, enter: 0 };
  const pointer = { on: false, x: 0, z: 0, sx: 0, sy: 0 };
  let walkers = [];
  let motes = [];
  let W = 0, H = 0, dpr = 1, cx = 0, y0 = 0, f = 1, eye = 1;
  let doorTop = 0, doorBottom = 0, doorW = 0, doorH = 0, zNear = 1;
  let pulse = 0;
  let entered = 0;
  let raf = 0;
  let last = 0;
  let visible = true;

  const sx = (x, z) => cx + (f * x) / z;
  const sy = (y, z) => y0 + (f * (eye - y)) / z;
  const halfWidth = (z) => ((W / 2) * z) / f;
  const spillEdge = (z) => DOOR_W / 2 + SPREAD * (DOOR_Z - z);
  // How much door light reaches a spot on the floor: strongest at the threshold, fading toward the viewer and the spill's edges.
  const lightAt = (x, z) => {
    const along = Math.max(0, 1 - (DOOR_Z - z) / (DOOR_Z - zNear + 1.5));
    const edge = Math.max(0, 1 - Math.abs(x) / spillEdge(z));
    return along ** 1.3 * Math.min(1, edge * 2);
  };
  // A floor circle seen from above and ahead is an ellipse; this is its height-to-width ratio.
  const squash = (z) => eye / Math.hypot(eye, z);

  function layout() {
    const r = canvas.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    if (!r.width || !s.width) return false;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    for (const c of [canvas, backdrop, layer]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    doorW = s.width;
    doorH = s.height;
    cx = s.left - r.left + doorW / 2;
    doorTop = s.top - r.top;
    doorBottom = doorTop + doorH;
    f = (doorW * DOOR_Z) / DOOR_W;
    // The nearest walker, at the bottom edge, is at most half the door's height on screen.
    const tallest = Math.min(doorH * 0.5, H * 0.17);
    zNear = Math.min(DOOR_Z * 0.6, (f * PERSON) / tallest);
    eye = Math.max(1, (H - doorBottom) / (f * (1 / zNear - 1 / DOOR_Z)));
    y0 = doorBottom - (f * eye) / DOOR_Z;
    paintBackdrop();
    return true;
  }

  // Everything that doesn't move, painted once per layout.
  function paintBackdrop() {
    const c = bctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const midY = doorTop + doorH / 2;

    const room = c.createRadialGradient(cx, midY, 0, cx, midY, Math.max(W, H) * 0.7);
    room.addColorStop(0, "rgba(190, 205, 255, 0.12)");
    room.addColorStop(0.4, "rgba(190, 205, 255, 0.03)");
    room.addColorStop(1, "rgba(0, 0, 0, 0)");
    c.fillStyle = room;
    c.fillRect(0, 0, W, H);

    // Floor grid: lines along z run into the doorway, lines across z bunch up toward it.
    const far = zNear * 0.75;
    c.lineWidth = 1;
    for (let x = -36; x <= 36; x += 2) {
      const fade = Math.max(0, 1 - Math.abs(x) / 36);
      const g = c.createLinearGradient(0, doorBottom, 0, H);
      g.addColorStop(0, "rgba(255,255,255,0.01)");
      g.addColorStop(1, `rgba(255,255,255,${0.075 * fade})`);
      c.strokeStyle = g;
      c.beginPath();
      c.moveTo(sx(x, DOOR_Z), sy(0, DOOR_Z));
      c.lineTo(sx(x, far), sy(0, far));
      c.stroke();
    }
    for (let z = DOOR_Z - 0.8; z > far; z -= 0.8) {
      c.strokeStyle = `rgba(255,255,255,${0.065 * (1 - (z - zNear) / (DOOR_Z - zNear))})`;
      c.beginPath();
      c.moveTo(0, sy(0, z));
      c.lineTo(W, sy(0, z));
      c.stroke();
    }
    // Where the floor meets the wall.
    const base = c.createLinearGradient(0, 0, W, 0);
    base.addColorStop(0, "rgba(255,255,255,0)");
    base.addColorStop(cx / W, "rgba(255,255,255,0.2)");
    base.addColorStop(1, "rgba(255,255,255,0)");
    c.strokeStyle = base;
    c.beginPath();
    c.moveTo(0, doorBottom + 0.5);
    c.lineTo(W, doorBottom + 0.5);
    c.stroke();

    // The spill of light across the floor, softened.
    c.save();
    c.globalCompositeOperation = "lighter";
    if ("filter" in c) c.filter = `blur(${Math.round(doorW * 0.1)}px)`;
    const spill = c.createLinearGradient(0, doorBottom, 0, H);
    spill.addColorStop(0, "rgba(228, 235, 255, 0.62)");
    spill.addColorStop(0.3, "rgba(205, 218, 255, 0.2)");
    spill.addColorStop(1, "rgba(190, 205, 255, 0.02)");
    c.fillStyle = spill;
    c.beginPath();
    c.moveTo(sx(-DOOR_W / 2, DOOR_Z), doorBottom);
    c.lineTo(sx(DOOR_W / 2, DOOR_Z), doorBottom);
    c.lineTo(sx(spillEdge(far), far), sy(0, far));
    c.lineTo(sx(-spillEdge(far), far), sy(0, far));
    c.closePath();
    c.fill();
    c.restore();

    // Bloom around the opening, then the opening itself.
    c.save();
    c.globalCompositeOperation = "lighter";
    const bloom = c.createRadialGradient(cx, midY, doorW * 0.25, cx, midY, doorH * 1.2);
    bloom.addColorStop(0, "rgba(215, 225, 255, 0.5)");
    bloom.addColorStop(0.28, "rgba(170, 190, 255, 0.13)");
    bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
    c.fillStyle = bloom;
    c.fillRect(cx - doorH * 1.3, midY - doorH * 1.3, doorH * 2.6, doorH * 2.6);
    c.restore();
    const light = c.createLinearGradient(0, doorTop, 0, doorBottom);
    light.addColorStop(0, "#ffffff");
    light.addColorStop(1, "#e2e9ff");
    c.fillStyle = light;
    c.shadowColor = "rgba(210, 222, 255, 0.9)";
    c.shadowBlur = doorW * 0.5;
    c.fillRect(cx - doorW / 2, doorTop, doorW, doorH);
    c.shadowBlur = 0;
    // The floor carries on past the threshold, a shade darker than the light.
    const beyond = c.createLinearGradient(0, doorBottom - doorH * 0.16, 0, doorBottom);
    beyond.addColorStop(0, "rgba(150, 165, 215, 0)");
    beyond.addColorStop(1, "rgba(150, 165, 215, 0.1)");
    c.fillStyle = beyond;
    c.fillRect(cx - doorW / 2, doorBottom - doorH * 0.16, doorW, doorH * 0.16);
  }

  function spawn(w = {}, scatter = false) {
    const fromSide = Math.random() < 0.8;
    const z = fromSide ? rand(zNear + 0.6, DOOR_Z - 1.6) : zNear * rand(0.84, 0.93);
    const half = halfWidth(z);
    w.x = fromSide ? (Math.random() < 0.5 ? -1 : 1) * (half + rand(0.4, 2)) : rand(-half, half) * 0.8;
    w.z = z;
    w.speed = rand(1.1, 1.6);
    w.phase = rand(0, Math.PI * 2);
    w.height = rand(1.55, 1.92);
    w.build = rand(0.88, 1.14);
    w.lane = rand(-1.3, 1.3); // where they cross the threshold; the doorway is 3.5 m wide
    w.wait = scatter ? 0 : rand(0, 2.5);
    w.counted = false;
    // A few looks so the crowd isn't a row of clones.
    w.hair = Math.random() < 0.35;
    w.skirt = Math.random() < 0.2;
    w.bag = Math.random() < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    if (scatter) {
      // Open the page mid-scene instead of with everyone at the edges.
      const t = rand(0, 0.9);
      w.x += (w.lane - w.x) * t;
      w.z += (DOOR_Z - 1.2 - w.z) * t;
    }
    // Face the way they're about to walk.
    const hx = w.lane - w.x;
    const hz = DOOR_Z - 1.2 - w.z;
    const hl = Math.hypot(hx, hz) || 1;
    w.hx = hx / hl;
    w.hz = hz / hl;
    return w;
  }

  function populate() {
    const count = Math.round(Math.min(44, Math.max(16, W / 34)));
    walkers = Array.from({ length: count }, () => spawn({}, true));
    motes = Array.from({ length: 26 }, () => ({ x: rand(-1, 1) * DOOR_W * 0.6, z: rand(DOOR_Z - 2.6, DOOR_Z - 0.2), y: rand(0.2, DOOR_H), v: rand(0.12, 0.4), tw: rand(0, 6) }));
  }

  function step(dt) {
    pulse *= Math.exp(-dt * 2.2);
    for (const w of walkers) {
      if (w.wait > 0) {
        w.wait -= dt;
        continue;
      }
      // Head for a spot just in front of the door, then on through it.
      const close = w.z > DOOR_Z - 1.3;
      let dx = w.lane - w.x;
      let dz = (close ? DOOR_Z + 2 : DOOR_Z - 1.2) - w.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      // Step out of the way of the pointer, and hurry a little while doing it.
      // Anyone already at the threshold is committed and walks on.
      if (pointer.on && w.z < DOOR_Z - 0.5) {
        const px = w.x - pointer.x;
        const pz = w.z - pointer.z;
        const d = Math.hypot(px, pz);
        if (d < AVOID && d > 0.001) {
          const push = ((AVOID - d) / AVOID) ** 1.2 * 3.4;
          dx += (px / d) * push;
          dz += (pz / d) * push * 0.6;
        }
      }
      w.x += dx * w.speed * dt;
      w.z += dz * w.speed * dt;
      // Turn smoothly toward the direction of travel.
      const vl = Math.hypot(dx, dz) || 1;
      const turn = Math.min(1, dt * 5);
      w.hx += (dx / vl - w.hx) * turn;
      w.hz += (dz / vl - w.hz) * turn;
      const hl = Math.hypot(w.hx, w.hz) || 1;
      w.hx /= hl;
      w.hz /= hl;
      w.phase += dt * w.speed * Math.min(1.6, vl) * 4.6;
      if (!w.counted && w.z >= DOOR_Z) {
        w.counted = true;
        pulse = Math.min(1, pulse + 0.12);
        if (state.power > 0.9) onEnter?.(++entered);
      }
      if (w.z >= DOOR_Z + FADE) spawn(w);
    }
    for (const m of motes) {
      m.y += m.v * dt;
      m.tw += dt;
      if (m.y > DOOR_H) Object.assign(m, { y: 0.2, x: rand(-1, 1) * DOOR_W * 0.6, z: rand(DOOR_Z - 2.6, DOOR_Z - 0.2) });
    }
  }

  // Pose a walker as a tiny 3D rig and flatten it to screen shapes. Local axes: r to their right,
  // u up, fw the way they face. Facing away you see a back view; crossing the room, a side view.
  function pose(w, x, feet, s) {
    const H = w.height;
    const b = w.build;
    const slope = eye / w.z;
    const side = Math.abs(w.hx);
    const back = Math.abs(w.hz);
    const at = (r, u, fw) => [x + (r * w.hz + fw * w.hx) * s, feet - u * s - (fw * w.hz - r * w.hx) * s * slope];
    const sway = 0.012 * H * Math.sin(w.phase);
    const shapes = { lines: [], torsos: [], quads: [], ovals: [], boxes: [] };

    // Legs: the thigh swings, the knee folds as the leg comes through, and whichever foot is lower holds the floor.
    const thigh = 0.245 * H;
    const shin = 0.25 * H;
    const legs = [-1, 1].map((sideSign, i) => {
      const p = w.phase + i * Math.PI;
      const a = 0.42 * Math.sin(p);
      const k = 0.06 + 0.95 * Math.max(0, Math.cos(p)) ** 2;
      return { sideSign, p, a, k, drop: 0.505 * H - thigh * Math.cos(a) - shin * Math.cos(a - k) };
    });
    const hipU = 0.505 * H - Math.min(legs[0].drop, legs[1].drop);
    for (const { sideSign, a, k } of legs) {
      const r = sideSign * 0.085 * b;
      const knee = [r, hipU - thigh * Math.cos(a), thigh * Math.sin(a)];
      const ankle = [r * 0.94, knee[1] - shin * Math.cos(a - k), knee[2] + shin * Math.sin(a - k)];
      const toe = [ankle[0], Math.max(0, ankle[1] - 0.03 * H), ankle[2] + 0.13 * H];
      shapes.lines.push([...at(r + sway, hipU, 0), ...at(...knee), 0.165 * b * s]);
      shapes.lines.push([...at(...knee), ...at(...ankle), 0.11 * s]);
      shapes.lines.push([...at(...ankle), ...at(...toe), 0.075 * s]);
    }

    // Arms swing against the leg on the same side; the elbow bends more on the forward swing.
    const shoulderU = 0.815 * H;
    for (const { sideSign, p } of legs) {
      const c = -0.36 * Math.sin(p);
      const d = c + 0.22 + 0.4 * Math.max(0, c);
      const shoulder = [sideSign * 0.185 * b + sway, shoulderU - 0.03 * H, 0];
      const elbow = [sideSign * 0.2 * b + sway, shoulder[1] - 0.18 * H * Math.cos(c), 0.18 * H * Math.sin(c)];
      const hand = [sideSign * 0.205 * b + sway, elbow[1] - 0.16 * H * Math.cos(d), elbow[2] + 0.16 * H * Math.sin(d)];
      shapes.lines.push([...at(...shoulder), ...at(...elbow), 0.1 * b * s]);
      shapes.lines.push([...at(...elbow), ...at(...hand), 0.08 * s]);
    }

    // Torso, seen wide from behind and narrow side-on, with sloped shoulders and a waist.
    const [tx, ty] = at(sway, shoulderU, 0.02 * H);
    const [bx, by] = at(sway, hipU + 0.02 * H, 0);
    const hipW = s * b * (0.32 * back + 0.24 * side);
    shapes.torsos.push([tx, ty, s * b * (0.42 * back + 0.25 * side), bx, by, hipW, 0.035 * H * s]);
    if (w.skirt) {
      const [kx, ky] = at(sway, 0.36 * H, 0);
      shapes.quads.push([bx, by - 0.05 * H * s, hipW, kx, ky, hipW * 1.5]);
    }
    if (w.bag) {
      const [qx, qy] = at(w.bag * 0.27 * b + sway, 0.52 * H, 0);
      const [sx0, sy0] = at(w.bag * 0.13 * b + sway, shoulderU + 0.01 * H, 0);
      shapes.lines.push([sx0, sy0, qx, qy - 0.06 * H * s, 0.025 * s]);
      shapes.boxes.push([qx, qy, 0.16 * s * (back + 0.5 * side), 0.16 * H * s]);
    }

    // Neck, head, and long hair falling to the shoulders.
    const [nx, ny] = at(sway, shoulderU + 0.06 * H, 0);
    shapes.lines.push([tx, ty, nx, ny, 0.11 * s]);
    const [hx, hy] = at(sway, H - 0.065 * H, 0);
    const headW = s * (0.076 * back + 0.095 * side);
    shapes.ovals.push([hx, hy, headW, 0.068 * H * s]);
    if (w.hair) {
      const [lx, ly] = at(sway, 0.78 * H, -0.03 * H);
      shapes.lines.push([hx, hy, lx, ly, headW * 2.15]);
    }
    return shapes;
  }

  // One pass of a posed figure: the rim pass draws everything a little fatter in door light,
  // the black pass draws it again on top, so only a thin lit edge survives.
  function paint(g, shapes, grow) {
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const [x1, y1, x2, y2, width] of shapes.lines) {
      g.lineWidth = width + grow * 2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.lineWidth = grow * 2 + 0.5;
    for (const [tx, ty, ws, bx, by, wh, drop] of shapes.torsos) {
      const len = by - ty;
      const wx = tx + (bx - tx) * 0.6;
      const wy = ty + len * 0.6;
      const ww = Math.min(ws, wh) * 0.86;
      g.beginPath();
      g.moveTo(tx - ws * 0.16, ty - drop);
      g.quadraticCurveTo(tx - ws * 0.47, ty - drop * 0.6, tx - ws * 0.5, ty + len * 0.12);
      g.quadraticCurveTo(wx - ww * 0.53, wy - len * 0.2, wx - ww / 2, wy);
      g.quadraticCurveTo(bx - wh * 0.5, by - len * 0.12, bx - wh / 2, by);
      g.lineTo(bx + wh / 2, by);
      g.quadraticCurveTo(bx + wh * 0.5, by - len * 0.12, wx + ww / 2, wy);
      g.quadraticCurveTo(wx + ww * 0.53, wy - len * 0.2, tx + ws * 0.5, ty + len * 0.12);
      g.quadraticCurveTo(tx + ws * 0.47, ty - drop * 0.6, tx + ws * 0.16, ty - drop);
      g.closePath();
      g.fill();
      g.stroke();
    }
    for (const [x1, y1, w1, x2, y2, w2] of shapes.quads) {
      g.beginPath();
      g.moveTo(x1 - w1 / 2, y1);
      g.lineTo(x1 + w1 / 2, y1);
      g.lineTo(x2 + w2 / 2, y2);
      g.lineTo(x2 - w2 / 2, y2);
      g.closePath();
      g.fill();
      g.stroke();
    }
    for (const [x, y, w, h] of shapes.boxes) {
      g.beginPath();
      g.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.3);
      g.fill();
      g.stroke();
    }
    for (const [x, y, rx, ry] of shapes.ovals) {
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  function figure(g, w, x, feet, s, h, lit, through) {
    if (!through) {
      // A short shadow on the floor, thrown toward the viewer by the door behind.
      g.fillStyle = `rgba(0,0,0,${0.3 + lit * 0.55})`;
      g.beginPath();
      g.ellipse(x, feet + h * 0.03, h * 0.17, h * 0.17 * squash(w.z) * 0.9, 0, 0, Math.PI * 2);
      g.fill();
    }
    const shapes = pose(w, x, feet, s);
    const rim = `rgba(205, 218, 255, ${0.14 + lit * 0.62})`;
    g.strokeStyle = rim;
    g.fillStyle = rim;
    paint(g, shapes, Math.max(0.7, h * 0.008));
    g.strokeStyle = "#000";
    g.fillStyle = "#000";
    paint(g, shapes, 0);
  }

  function drawWalker(w) {
    const x = sx(w.x, w.z);
    const feet = sy(0, w.z);
    const s = f / w.z;
    const h = s * w.height;
    if (x < -h || x > W + h) return;
    // Past the threshold they walk on into the light and fade over about a metre.
    const fade = Math.min(1, Math.max(0, (DOOR_Z + FADE - w.z) / (FADE + 0.3))) ** 2;
    if (fade <= 0.01) return;
    const lit = lightAt(Math.max(-DOOR_W, Math.min(DOOR_W, w.x)), Math.min(w.z, DOOR_Z)) * state.power;
    const through = w.z > DOOR_Z;
    if (fade > 0.999) {
      figure(lctx, w, x, feet, s, h, lit, through);
      return;
    }
    // A fading figure is drawn solid on its own sheet first, then faded as one piece,
    // so its limbs don't show through each other.
    const bw = Math.ceil(h * 0.95);
    const bh = Math.ceil(h * 1.25);
    const ox = x - bw / 2;
    const oy = feet - h * 1.1;
    if (scratch.width < bw * dpr || scratch.height < bh * dpr) {
      scratch.width = Math.ceil(bw * dpr);
      scratch.height = Math.ceil(bh * dpr);
    }
    sctx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
    sctx.clearRect(ox, oy, bw, bh);
    figure(sctx, w, x, feet, s, h, lit, through);
    lctx.save();
    if (through) {
      lctx.beginPath();
      lctx.rect(cx - doorW / 2, doorTop, doorW, doorH);
      lctx.clip();
    }
    lctx.globalAlpha = fade;
    lctx.drawImage(scratch, 0, 0, bw * dpr, bh * dpr, ox, oy, bw, bh);
    lctx.restore();
  }

  function draw() {
    const s = 1 + state.enter * state.enter * 2.2;
    const ox = cx;
    const oy = doorTop + doorH * 0.6;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (ox - ox * s), dpr * (oy - oy * s));
    ctx.clearRect(-W, -H, W * 3, H * 3);
    ctx.globalAlpha = Math.min(1, state.power * (0.9 + pulse * 0.15));
    ctx.drawImage(backdrop, 0, 0, W, H);
    if (state.enter > 0) {
      // Closer to the door, the light swells before the room fades out.
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = state.enter * 0.9;
      ctx.drawImage(backdrop, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;

    for (const m of motes) {
      const a = (0.3 + 0.3 * Math.sin(m.tw * 2)) * state.power * Math.max(0.25, lightAt(m.x, m.z));
      ctx.fillStyle = `rgba(235, 240, 255, ${a})`;
      ctx.beginPath();
      ctx.arc(sx(m.x, m.z), sy(m.y, m.z), Math.max(0.7, (f * 0.03) / m.z), 0, Math.PI * 2);
      ctx.fill();
    }

    if (pointer.on) {
      const rx = (f * AVOID * 0.75) / pointer.z;
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(pointer.sx, pointer.sy, rx, rx * squash(pointer.z), 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, W, H);
    walkers.sort((a, b) => b.z - a.z);
    for (const w of walkers) if (w.wait <= 0) drawWalker(w);
    // Walking toward the door, the camera passes people, so they dissolve instead of looming.
    ctx.globalAlpha = Math.max(0, 1 - state.enter * 1.8);
    ctx.drawImage(layer, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (reduced || raf || !visible) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Screen point -> spot on the floor, or null above the wall line or while the camera is moving.
  function toFloor(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    if (state.enter > 0.02 || py < doorBottom + 6) return null;
    const z = (f * eye) / (py - y0);
    return { x: ((px - cx) * z) / f, z, sx: px, sy: py };
  }

  function onMove(e) {
    const p = toFloor(e.clientX, e.clientY);
    pointer.on = Boolean(p);
    if (p) Object.assign(pointer, p);
  }
  function onLeave() {
    pointer.on = false;
  }
  const host = canvas.parentElement;
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);

  const relayout = () => {
    if (!layout()) return;
    if (!walkers.length) populate();
    draw();
  };
  const resize = new ResizeObserver(relayout);
  resize.observe(canvas);
  window.addEventListener("resize", relayout);
  document.fonts?.ready.then(relayout);
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) play();
    else pause();
  });
  seen.observe(canvas);

  relayout();
  play();

  return {
    state,
    stop() {
      pause();
      resize.disconnect();
      seen.disconnect();
      window.removeEventListener("resize", relayout);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    },
  };
}

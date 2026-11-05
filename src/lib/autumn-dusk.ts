/** Browser rendering of the supplied AutumnDusk.pde.
 * Keeps the original coordinates, palette, seed, 86 BPM clock and leaf lifecycle.
 * Java and Canvas antialiasing/float arithmetic differ slightly.
 * Noise is a one-dimensional, cosine-interpolated, four-octave value field.
 */
export const WIDTH = 1200;
export const HEIGHT = 800;
export const BPM = 86;
export const DUSK_SECONDS = 44 * 4 * 60 / BPM;
export const INITIAL_SEED = 241;
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => Math.round(lerp(v, b[i], t))) as RGB;
const color = (rgb: RGB, alpha = 255) => `rgba(${rgb.join(',')},${Math.max(0, Math.min(255, alpha)) / 255})`;

/** java.util.Random's documented 48-bit LCG and nextFloat sequence. */
export class SeededRandom {
  state: bigint;
  constructor(seed: number) { this.state = (BigInt(seed) ^ 0x5deece66dn) & ((1n << 48n) - 1n); }
  next() {
    this.state = (this.state * 0x5deece66dn + 11n) & ((1n << 48n) - 1n);
    return Number(this.state >> 24n) / 16777216;
  }
  between(low: number, high?: number) {
    if (high === undefined) { high = low; low = 0; }
    return low + this.next() * (high - low);
  }
}

function createNoise(seed: number) {
  const rng = new SeededRandom(seed);
  const values = Float32Array.from({ length: 4096 }, () => rng.next());
  return (position: number) => {
    let x = Math.abs(position), sum = 0, amplitude = .5;
    for (let octave = 0; octave < 4; octave++) {
      const index = Math.floor(x), fraction = x - index;
      const blend = .5 - .5 * Math.cos(Math.floor(fraction * 360) * Math.PI / 360);
      sum += lerp(values[index & 4095], values[(index + 1) & 4095], blend) * amplitude;
      amplitude *= .5; x *= 2;
    }
    return sum;
  };
}

type Twig = { x: number; y: number; ex: number; ey: number; weight: number };
type Leaf = { twig: Twig; position: number; angle: number; size: number; life: number; offset: number; phase: number; drift: number };
const point = (twig: Twig, p: number) => ({ x: lerp(twig.x, twig.ex, p) + Math.sin(p * Math.PI) * 9, y: lerp(twig.y, twig.ey, p) });

export class AutumnDusk {
  seed: number;
  twigs: Twig[] = [];
  leaves: Leaf[] = [];
  paper: HTMLCanvasElement;
  noise: (position: number) => number;
  constructor(seed: number, createCanvas: (width: number, height: number) => HTMLCanvasElement) {
    this.seed = seed;
    const rng = new SeededRandom(seed);
    const random = (a: number, b?: number) => rng.between(a, b);
    this.noise = createNoise(seed);
    const branch = (x: number, y: number, length: number, angle: number, depth: number, weight: number) => {
      const twig = { x, y, ex: x + Math.cos(angle) * length, ey: y + Math.sin(angle) * length, weight };
      random(100); // The original stores an unused phase; keep its random draw.
      this.twigs.push(twig);
      if (depth <= 2) for (let j = 0; j < 4; j++) {
        const size = random(15, 32), life = random(64, 105);
        this.leaves.push({ twig, position: .3 + j * .2, angle: angle + (j % 2 === 0 ? -.85 : .8), size, life, offset: random(life), phase: random(TAU), drift: random(40, 150) });
      }
      if (depth > 0) {
        branch(twig.ex, twig.ey, length * random(.62, .75), angle - random(.23, .5), depth - 1, weight * .66);
        branch(twig.ex, twig.ey, length * random(.48, .67), angle + random(.35, .72), depth - 1, weight * .6);
      }
    };
    branch(72, 830, 250, -1.13, 4, 4.5);
    branch(1240, 108, 245, 2.74, 3, 3.1);
    branch(-50, 480, 170, -.48, 2, 2.1);
    this.paper = createCanvas(WIDTH, HEIGHT);
    const paper = this.paper.getContext('2d');
    if (!paper) throw new Error('Canvas 2D is unavailable.');
    for (let i = 0; i < 52000; i++) {
      const x = random(WIDTH), y = random(HEIGHT);
      paper.fillStyle = random(1) < .5 ? color([75, 53, 41], 11) : color([255, 243, 216], 20);
      paper.beginPath(); paper.ellipse(x, y, random(.5, 1.8) / 2, random(.5, 1.3) / 2, 0, 0, TAU); paper.fill();
    }
  }

  render(ctx: CanvasRenderingContext2D, seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Time must be a nonnegative finite number.');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round'; ctx.lineJoin = 'miter';
    const dusk = .5 - .5 * Math.cos(TAU * seconds / DUSK_SECONDS);
    const top = mix([192, 182, 164], [107, 115, 118], dusk);
    const bottom = mix([235, 206, 157], [185, 140, 115], dusk);
    for (let y = 0; y < HEIGHT; y++) {
      ctx.fillStyle = color(mix(top, bottom, (y / HEIGHT) ** .82));
      ctx.fillRect(0, y, WIDTH, 1);
    }
    ctx.fillStyle = color([255, 219, 157], .48 * (1 - dusk * .5));
    for (let r = 210; r > 0; r -= 3) {
      ctx.beginPath(); ctx.arc(WIDTH * .69, HEIGHT * .41, r, 0, TAU); ctx.fill();
    }
    ctx.lineWidth = .7;
    for (let i = 0; i < 34; i++) {
      const y = HEIGHT * .73 + i * 6.8, x = WIDTH * .37 + this.noise(i * .2) * 190;
      const length = 50 + this.noise(i + 40) * 330;
      ctx.strokeStyle = color([92, 93, 88], 10 + 5 * Math.sin(i));
      ctx.beginPath(); ctx.moveTo(x + Math.sin(seconds * .07 + i) * 10, y); ctx.lineTo(x + length, y); ctx.stroke();
    }
    ctx.strokeStyle = color([72, 61, 50], 155);
    for (const twig of this.twigs) {
      ctx.lineWidth = twig.weight; ctx.beginPath();
      for (let i = 0; i <= 20; i++) {
        const p = point(twig, i / 20);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    for (const leaf of this.leaves) this.paintLeaf(ctx, leaf, seconds);
    const beatInBar = (seconds * BPM / 60) % 4;
    const pulse = Math.exp(-Math.max(0, (beatInBar - 1 + 4) % 2) * 12);
    ctx.fillStyle = color([112, 75, 49], 8 + pulse * 17);
    for (let i = 0; i < 19; i++) {
      const x = 330 + this.noise(i * 7.1) * 570, y = 400 + this.noise(i * 3.4 + 80) * 230;
      ctx.beginPath(); ctx.arc(x, y, .65, 0, TAU); ctx.fill();
    }
    ctx.drawImage(this.paper, 0, 0);
    ctx.strokeStyle = color([244, 230, 204], 85); ctx.lineWidth = 18;
    ctx.strokeRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  private paintLeaf(ctx: CanvasRenderingContext2D, leaf: Leaf, clock: number) {
    const age = ((clock + leaf.offset) % leaf.life) / leaf.life;
    if (age > .97) return;
    const opening = ease(0, .16, age), autumn = ease(.18, .48, age), dry = ease(.44, .68, age);
    const fall = ease(.67, .92, age), fade = 1 - ease(.89, .97, age);
    const p = point(leaf.twig, leaf.position), wind = Math.sin(clock * .5 + leaf.phase) * .07;
    const x = p.x + fall * leaf.drift + Math.sin(fall * Math.PI * 3 + leaf.phase) * fall * 23;
    const ground = HEIGHT - 34 - 12 * Math.sin(leaf.phase);
    const y = lerp(p.y, Math.max(p.y + 45, ground), fall);
    const tint = mix(mix([126, 134, 80], [195, 141, 58], autumn), [138, 74, 44], dry);
    const rotation = leaf.angle + wind + fall * 3.5;
    if (fall > 0 && fall < .98) this.leafShape(ctx, leaf.size, x - 8 * fall, y - 13 * fall, rotation, opening, dry, tint, fade * 17);
    this.leafShape(ctx, leaf.size, x, y, rotation + Math.sin(fall * 8) * .25, opening, dry, tint, fade * 195);
  }

  private leafShape(ctx: CanvasRenderingContext2D, size: number, x: number, y: number, rotation: number, opening: number, dry: number, tint: RGB, alpha: number) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
    const length = size * (.13 + .87 * opening) * (1 - dry * .17);
    const w = length * (.06 + .30 * opening) * (1 - dry * .55), curl = dry * length * .17;
    ctx.fillStyle = color(tint, alpha); ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.bezierCurveTo(length * .22, -w, length * .7, -w, length, curl);
    ctx.bezierCurveTo(length * .62, w + curl, length * .23, w, 0, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = color([88, 65, 40], alpha * .52); ctx.lineWidth = .65;
    ctx.beginPath(); ctx.moveTo(-3, 0); ctx.bezierCurveTo(length * .3, 0, length * .65, curl * .3, length, curl); ctx.stroke();
    ctx.beginPath();
    for (let j = 1; j <= 3; j++) {
      const q = j * .21;
      ctx.moveTo(length * q, curl * q * q); ctx.lineTo(length * (q + .17), -w * .56 + curl * q);
      ctx.moveTo(length * q, curl * q * q); ctx.lineTo(length * (q + .12), w * .53 + curl * q);
    }
    ctx.stroke(); ctx.restore();
  }
}

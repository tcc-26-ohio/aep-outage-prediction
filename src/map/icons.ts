// Canvas-drawn marker icons so each asset class has a distinct shape as well as a distinct color.
import type { Map } from 'maplibre-gl';

const S = 36; // 18px @ pixelRatio 2

function make(draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d')!;
  c.lineJoin = 'round';
  draw(c);
  return c.getImageData(0, 0, S, S);
}

function poly(c: CanvasRenderingContext2D, sides: number, r: number, rot = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    const x = S / 2 + r * Math.cos(a), y = S / 2 + r * Math.sin(a);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}

function shape(sides: number, fill: string, stroke: string, r = 13, rot?: number) {
  return make(c => {
    poly(c, sides, r, rot);
    c.fillStyle = fill; c.fill();
    c.lineWidth = 3; c.strokeStyle = stroke; c.stroke();
  });
}

function badge(letter: string, fill: string) {
  return make(c => {
    c.beginPath(); c.roundRect(3, 3, S - 6, S - 6, 7);
    c.fillStyle = fill; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 20px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(letter, S / 2, S / 2 + 1);
  });
}

export const ICON_COLORS = {
  transformer: '#c084fc', fuse: '#f8fafc', switchClosed: '#2dd4bf', switchOpen: '#fb7185', recloser: '#60a5fa',
  arcos: '#ef4444', repaired48: '#22c55e', repaired30: '#14b8a6', repairedOld: '#94a3b8', hospital: '#e11d48', fire: '#ea580c', ambulance: '#2563eb',
};

export function addIcons(map: Map) {
  const add = (name: string, img: ImageData) => map.hasImage(name) || map.addImage(name, img, { pixelRatio: 2 });
  add('tx', make(c => {
    c.beginPath(); c.roundRect(7, 7, S - 14, S - 14, 3);
    c.fillStyle = ICON_COLORS.transformer; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#2e1065'; c.stroke();
  }));
  add('fuse', shape(3, ICON_COLORS.fuse, '#0f172a', 14));
  add('sw-closed', shape(4, ICON_COLORS.switchClosed, '#042f2e', 14));
  add('sw-open', shape(4, '#0f172a', ICON_COLORS.switchOpen, 14));
  add('recloser', shape(6, ICON_COLORS.recloser, '#0b1e4a', 15, 0));
  add('arcos', make(c => {
    poly(c, 3, 16);
    c.fillStyle = ICON_COLORS.arcos; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = '#fff'; c.font = 'bold 18px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('!', S / 2, S / 2 + 5);
  }));
  // repaired recently: shape + color differ from the open-damage triangle and from each other (circle = last 48 h, diamond = last 30 days)
  const tick = (c: CanvasRenderingContext2D) => {
    c.beginPath(); c.moveTo(11, 18.5); c.lineTo(16, 23.5); c.lineTo(25, 12.5);
    c.lineWidth = 3.4; c.lineCap = 'round'; c.strokeStyle = '#fff'; c.stroke();
  };
  add('arcos-48h', make(c => {
    c.beginPath(); c.arc(S / 2, S / 2, 15, 0, Math.PI * 2);
    c.fillStyle = ICON_COLORS.repaired48; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    tick(c);
  }));
  add('arcos-30d', make(c => {
    poly(c, 4, 17);
    c.fillStyle = ICON_COLORS.repaired30; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    tick(c);
  }));
  // repaired earlier: small, muted grey ring so it stays out of the way of open and recent repairs
  add('arcos-old', make(c => {
    c.beginPath(); c.arc(S / 2, S / 2, 9, 0, Math.PI * 2);
    c.fillStyle = 'rgba(148,163,184,0.45)'; c.fill();
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(226,232,240,0.85)'; c.stroke();
  }));
  add('open-here', make(c => {
    // "open here": red no-entry disc with a break bar
    c.beginPath(); c.arc(S / 2, S / 2, 15, 0, Math.PI * 2);
    c.fillStyle = '#dc2626'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.roundRect(9, 15, 18, 6, 2); c.fill();
  }));
  add('hospital', make(c => {
    c.beginPath(); c.roundRect(3, 3, S - 6, S - 6, 7);
    c.fillStyle = ICON_COLORS.hospital; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    c.fillStyle = '#fff'; c.fillRect(15, 8, 6, 20); c.fillRect(8, 15, 20, 6);
  }));
  add('fire', badge('F', ICON_COLORS.fire));
  add('ambulance', badge('A', ICON_COLORS.ambulance));
}

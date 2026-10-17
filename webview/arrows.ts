// Draws the reference arrows as one SVG layer above the stack and the heap.
// Each arrow starts at a dot inside a variable, cell or attribute and ends at the object it points to.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function marker(id: string, cls: string): SVGMarkerElement {
  const m = svgEl('marker', {
    id,
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '7',
    markerHeight: '7',
    orient: 'auto-start-reverse',
  });
  m.append(svgEl('path', { d: 'M0 0L10 5L0 10z', class: cls }));
  return m;
}

/** Start of an arrow: the dot, and the right edge of the box that contains it. */
export interface ArrowSource {
  x: number;
  y: number;
  /** Right edge of the variable cell or of the object that contains the dot. */
  right: number;
}

/** Target of an arrow: the object box, and the height where the arrow should end. */
export interface ArrowTarget {
  left: number;
  right: number;
  /** y of the end point, usually the middle of the object's head. */
  y: number;
}

/**
 * Path of one arrow. When the target is to the right of the dot, the arrow ends at the target's
 * left edge. Otherwise (the target is above, below or to the left, for example an object that points
 * back to an earlier object) the arrow leaves to the right and ends at the target's right edge,
 * so it does not cross the rows of the object it starts in.
 */
export function arrowPath(s: ArrowSource, t: ArrowTarget): string {
  const f = (n: number) => n.toFixed(1);
  if (t.left >= s.x + 16) {
    const ex = t.left - 1;
    const c = Math.max(40, (ex - s.x) / 2);
    return `M ${f(s.x)} ${f(s.y)} C ${f(s.x + c)} ${f(s.y)}, ${f(ex - c)} ${f(t.y)}, ${f(ex)} ${f(t.y)}`;
  }
  const ex = t.right + 1;
  const cx = Math.max(s.right, t.right) + 50;
  return `M ${f(s.x)} ${f(s.y)} C ${f(cx)} ${f(s.y)}, ${f(cx)} ${f(t.y)}, ${f(ex)} ${f(t.y)}`;
}

function sizeLayer(svg: SVGSVGElement, width: number, height: number): void {
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
}

function markers(): SVGDefsElement {
  const defs = svgEl('defs', {});
  defs.append(
    marker('hs-head', 'head'),
    marker('hs-head-active', 'head active'),
    marker('hs-head-hot', 'head hot'),
    generalizationMarker(),
  );
  return defs;
}

/**
 * Draws all arrows. There are two layers: `svg` (the lines) is below the class boxes, so a line
 * that crosses the classes part goes behind the class boxes; `top` (the dots where arrows start,
 * the "extends" lines and the dashed class links) is above everything.
 */
export function drawArrows(canvas: HTMLElement, svg: SVGSVGElement, top: SVGSVGElement): void {
  svg.replaceChildren(markers());
  top.replaceChildren(markers());

  // The layers cover the whole scroll area; their size is set to 0 first so that they do not change the area.
  sizeLayer(svg, 0, 0);
  sizeLayer(top, 0, 0);
  const width = canvas.scrollWidth;
  const height = canvas.scrollHeight;
  sizeLayer(svg, width, height);
  sizeLayer(top, width, height);

  const origin = canvas.getBoundingClientRect();
  const ox = origin.left - canvas.scrollLeft;
  const oy = origin.top - canvas.scrollTop;
  const lines: SVGElement[] = [];
  const dots: SVGElement[] = [];
  for (const ptr of canvas.querySelectorAll<HTMLElement>('.ptr[data-target]')) {
    const target = canvas.querySelector<HTMLElement>(`.obj[data-id="${ptr.dataset.target}"]`);
    if (!target) continue;
    const p = ptr.getBoundingClientRect();
    const holder = (ptr.closest('.obj') ?? ptr.closest('.slot') ?? ptr).getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const anchor = (target.querySelector('.cells, .uml-head, .fn-head') ?? target).getBoundingClientRect();
    const source: ArrowSource = { x: p.left + p.width / 2 - ox, y: p.top + p.height / 2 - oy, right: holder.right - ox };
    const dest: ArrowTarget = { left: t.left - ox, right: t.right - ox, y: anchor.top - oy + Math.min(18, anchor.height / 2) };
    const active = !!ptr.closest('.frame.active');
    lines.push(
      svgEl('path', {
        d: arrowPath(source, dest),
        class: active ? 'arrow active' : 'arrow',
        'marker-end': `url(#${active ? 'hs-head-active' : 'hs-head'})`,
        'data-target': ptr.dataset.target ?? '',
      }),
    );
    dots.push(
      svgEl('circle', {
        cx: source.x.toFixed(1),
        cy: source.y.toFixed(1),
        r: '4.5',
        class: active ? 'dot active' : 'dot',
        'data-target': ptr.dataset.target ?? '',
      }),
    );
  }
  // Arrows of the running function are drawn last, so they are on top.
  const order = (e: SVGElement) => (e.classList.contains('active') ? 1 : 0);
  lines.sort((a, b) => order(a) - order(b));

  // "extends": from each subclass to its superclass.
  const gens: SVGElement[] = [];
  for (const sub of canvas.querySelectorAll<HTMLElement>('.class-box[data-super]')) {
    const sup = canvas.querySelector<HTMLElement>(`.class-box[data-id="${sub.dataset.super}"]`);
    if (!sup) continue;
    gens.push(svgEl('path', { d: generalizationPath(rect(sub, ox, oy), rect(sup, ox, oy)), class: 'gen', 'marker-end': 'url(#hs-gen)' }));
  }
  svg.append(...lines);
  top.append(...gens, ...dots, svgEl('g', { class: 'links' }));
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rect(e: Element, ox: number, oy: number): Box {
  const r = e.getBoundingClientRect();
  return { left: r.left - ox, top: r.top - oy, right: r.right - ox, bottom: r.bottom - oy };
}

function generalizationMarker(): SVGMarkerElement {
  const m = svgEl('marker', {
    id: 'hs-gen',
    viewBox: '0 0 12 12',
    refX: '11',
    refY: '6',
    markerWidth: '12',
    markerHeight: '12',
    markerUnits: 'userSpaceOnUse',
    orient: 'auto-start-reverse',
  });
  m.append(svgEl('path', { d: 'M1 1L11 6L1 11z', class: 'genhead' }));
  return m;
}

/**
 * Path of an "extends" line from a subclass box to its superclass box. The superclass is placed
 * first, so it is to the left (same row) or above (an earlier row).
 */
export function generalizationPath(sub: Box, sup: Box): string {
  const f = (n: number) => n.toFixed(1);
  if (sup.right <= sub.left - 8) {
    const y1 = sub.top + 50;
    const y2 = Math.min(sup.bottom - 10, Math.max(sup.top + 10, y1));
    const c = Math.max(20, (sub.left - sup.right) / 2);
    return `M ${f(sub.left)} ${f(y1)} C ${f(sub.left - c)} ${f(y1)}, ${f(sup.right + c)} ${f(y2)}, ${f(sup.right + 1)} ${f(y2)}`;
  }
  const x1 = (sub.left + sub.right) / 2;
  const x2 = Math.min(sup.right - 12, Math.max(sup.left + 12, x1));
  if (sup.bottom <= sub.top) {
    const c = Math.max(20, (sub.top - sup.bottom) / 2);
    return `M ${f(x1)} ${f(sub.top)} C ${f(x1)} ${f(sub.top - c)}, ${f(x2)} ${f(sup.bottom + c)}, ${f(x2)} ${f(sup.bottom + 1)}`;
  }
  const c = Math.max(20, (sup.top - sub.bottom) / 2);
  return `M ${f(x1)} ${f(sub.bottom)} C ${f(x1)} ${f(sub.bottom + c)}, ${f(x2)} ${f(sup.top - c)}, ${f(x2)} ${f(sup.top - 1)}`;
}

/**
 * Path of a dashed "made from this class" line: from the right edge of the object's head to the
 * bottom (or top) of the class box.
 */
export function classLinkPath(obj: Box, cls: Box): string {
  const f = (n: number) => n.toFixed(1);
  const sx = obj.right + 1;
  const sy = obj.top + 16;
  const ex = (cls.left + cls.right) / 2;
  const below = cls.bottom <= sy;
  const ey = below ? cls.bottom + 2 : cls.top - 2;
  const c = Math.max(30, Math.abs(sy - ey) / 2);
  return `M ${f(sx)} ${f(sy)} C ${f(Math.max(sx + 30, ex))} ${f(sy)}, ${f(ex)} ${f(below ? ey + c : ey - c)}, ${f(ex)} ${f(ey)}`;
}

/** Removes the dashed class links and the outlines of a previous mouse over. */
export function clearClassLinks(canvas: HTMLElement, svg: SVGSVGElement): void {
  svg.querySelector('g.links')?.replaceChildren();
  for (const e of canvas.querySelectorAll('.obj.related')) e.classList.remove('related');
}

/**
 * Mouse over an object: a dashed line to its class. Mouse over a class: dashed lines from all its
 * objects. The objects and the class get an outline.
 */
export function showClassLinks(canvas: HTMLElement, svg: SVGSVGElement, hovered: HTMLElement): void {
  clearClassLinks(canvas, svg);
  const layer = svg.querySelector('g.links');
  if (!layer) return;
  let pairs: [HTMLElement, HTMLElement][] = [];
  if (hovered.dataset.cls) {
    const cls = canvas.querySelector<HTMLElement>(`.class-box[data-id="${hovered.dataset.cls}"]`);
    if (cls) pairs = [[hovered, cls]];
  } else if (hovered.classList.contains('class-box')) {
    pairs = [...canvas.querySelectorAll<HTMLElement>(`.obj[data-cls="${hovered.dataset.id}"]`)].map((o) => [o, hovered]);
  }
  if (pairs.length === 0) return;
  const origin = canvas.getBoundingClientRect();
  const ox = origin.left - canvas.scrollLeft;
  const oy = origin.top - canvas.scrollTop;
  for (const [obj, cls] of pairs) {
    obj.classList.add('related');
    cls.classList.add('related');
    const head = obj.querySelector('.uml-head, .cells') ?? obj;
    const o = rect(obj, ox, oy);
    const h = rect(head, ox, oy);
    layer.append(
      svgEl('path', {
        d: classLinkPath({ ...o, top: h.top + Math.min(16, (h.bottom - h.top) / 2) - 16 }, rect(cls, ox, oy)),
        class: 'inst',
        'marker-end': 'url(#hs-head-hot)',
      }),
    );
  }
}

/** Highlights the arrows that point to one object (when the mouse is over the object). */
export function highlightArrows(svg: SVGSVGElement, top: SVGSVGElement, targetId: string | undefined): void {
  for (const path of svg.querySelectorAll<SVGPathElement>('path.arrow')) {
    const hot = targetId !== undefined && path.dataset.target === targetId;
    path.classList.toggle('hot', hot);
    const active = path.classList.contains('active');
    path.setAttribute('marker-end', `url(#${hot ? 'hs-head-hot' : active ? 'hs-head-active' : 'hs-head'})`);
  }
  for (const dot of top.querySelectorAll<SVGCircleElement>('circle.dot')) {
    dot.classList.toggle('hot', targetId !== undefined && dot.dataset.target === targetId);
  }
}

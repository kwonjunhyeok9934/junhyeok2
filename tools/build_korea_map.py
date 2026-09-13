"""시군구 경계 GeoJSON → js/koreamap.js (여행 탭에서 색칠할 SVG path 모음).

평소에는 실행할 일이 없다. 지도를 다시 만들어야 할 때만 쓴다:

    pip install shapely topojson
    python3 tools/build_korea_map.py            # 기본값으로 다시 만들기
    python3 tools/build_korea_map.py 0.006 6    # 더 거칠게(파일 작게)

원본은 통계청 2018 시군구 경계(southkorea/southkorea-maps, KOSTAT — 자유 이용)를 내려받아 쓴다.

하는 일:
- 일반시의 구(수원시장안구 …)는 시 하나로 합친다. 광역시 자치구는 그대로 둔다.
- topojson 으로 경계를 공유한 채 단순화한다. 그래야 지역 사이에 흰 틈이 생기지 않는다.
- 멀리 떨어진 섬(백령도·가거도 등)은 빼고, 울릉군만 동해 쪽으로 당겨 그린다.
  그래야 본토가 폰 화면에서 크게 보인다.
- 등장방형 투영(위도 보정) 후 좌표를 정수로 반올림한다.
"""
import json
import math
import os
import re
import sys
import urllib.request
from collections import defaultdict

import topojson as tp
from shapely.geometry import MultiPolygon, shape
from shapely.ops import unary_union

SRC_URL = ('https://raw.githubusercontent.com/southkorea/southkorea-maps/master/'
           'kostat/2018/json/skorea-municipalities-2018-geo.json')
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'skorea-municipalities-2018-geo.json')  # 내려받은 원본 (커밋하지 않는다)
OUT = os.path.join(HERE, '..', 'js', 'koreamap.js')

TOLERANCE = float(sys.argv[1]) if len(sys.argv) > 1 else 0.004   # 단순화 정도 (도)
MIN_AREA = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0      # 이보다 작은 섬은 생략 (투영 후 넓이)
W = 1600.0                    # viewBox 너비
CORE = (125.62, 129.62)       # 이 경도 밖의 섬은 그리지 않는다
ULLEUNG = ('37430', 129.80)   # 울릉군은 이 경도로 당겨 온다

SIDO = {
    '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주', '25': '대전',
    '26': '울산', '29': '세종', '31': '경기', '32': '강원', '33': '충북', '34': '충남',
    '35': '전북', '36': '전남', '37': '경북', '38': '경남', '39': '제주',
}


def merged(code, name):
    """일반시의 구는 시 코드로 합친다. (31011 수원시장안구 → 31010 수원시)"""
    if code[4] != '0':
        m = re.match(r'^(.*?시)(.+구)$', name)
        if m:
            return code[:4] + '0', m.group(1)
    return code, name


def load():
    if not os.path.exists(CACHE):
        print('원본 내려받는 중…', file=sys.stderr)
        urllib.request.urlretrieve(SRC_URL, CACHE)
    feats = json.load(open(CACHE))['features']
    geoms, names = defaultdict(list), {}
    for f in feats:
        p = f['properties']
        code, name = merged(p['code'], p['name'])
        names[code] = name
        geoms[code].append(shape(f['geometry']))
    print(f'지역 {len(feats)}개 → {len(geoms)}개', file=sys.stderr)
    return {c: unary_union(g) for c, g in geoms.items()}, names


def simplify(data):
    topo = tp.Topology(data, prequantize=1e6, toposimplify=TOLERANCE, shared_coords=False)
    return json.loads(topo.to_geojson())


def project(simple):
    """지역별 바깥 경계선을 투영 좌표로. 먼 섬은 버리고 울릉도는 당겨 온다."""
    k = math.cos(math.radians(36.2))
    rings, skipped = {}, 0
    for feat in simple['features']:
        code = str(feat['id'])
        g = shape(feat['geometry'])
        polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g]
        shift = ULLEUNG[1] - polys[0].centroid.x if code == ULLEUNG[0] else 0
        out = []
        for poly in polys:
            lon = poly.centroid.x + shift
            if not (CORE[0] <= lon <= CORE[1] or code == ULLEUNG[0]):
                skipped += 1
                continue
            out.append([((x + shift) * k, -y) for x, y in poly.exterior.coords])
        if out:
            rings[code] = out
    print(f'먼 섬 {skipped}개 제외', file=sys.stderr)
    return rings


def to_path(ring, minx, miny, scale):
    pts = [(round((x - minx) * scale), round((y - miny) * scale)) for x, y in ring]
    out = [pts[0]]
    for p in pts[1:]:
        if p != out[-1]:
            out.append(p)
    if len(out) < 3:
        return None, 0
    area = abs(sum(out[i][0] * out[i - 1][1] - out[i - 1][0] * out[i][1] for i in range(len(out)))) / 2
    d = f'M{out[0][0]} {out[0][1]}' + ''.join(f'L{x} {y}' for x, y in out[1:]) + 'Z'
    return d, area


def main():
    data, names = load()
    rings = project(simplify(data))

    xs = [x for rs in rings.values() for r in rs for x, _ in r]
    ys = [y for rs in rings.values() for r in rs for _, y in r]
    minx, miny = min(xs), min(ys)
    scale = W / (max(xs) - minx)
    height = round((max(ys) - miny) * scale)

    regions, dropped = [], 0
    for code in sorted(rings):
        parts = []
        for ring in rings[code]:
            d, area = to_path(ring, minx, miny, scale)
            if d:
                parts.append((area, d))
        if not parts:
            continue
        parts.sort(reverse=True, key=lambda t: t[0])
        keep = [parts[0][1]] + [d for a, d in parts[1:] if a >= MIN_AREA]   # 본섬은 작아도 남긴다
        dropped += len(parts) - len(keep)
        regions.append((code, names[code], SIDO[code[:2]], ''.join(keep)))

    print(f'작은 섬 {dropped}개 생략', file=sys.stderr)
    body = ',\n'.join('  { c: "%s", n: "%s", s: "%s", d: "%s" }' % r for r in regions)
    js = f'''// 대한민국 시·군·구 지도 — 여행 탭에서 다녀온 곳을 색칠한다.
// 자동 생성 파일이라 손으로 고치지 않는다. 다시 만드는 방법은 docs/지도_데이터.md 참고.
// 원본: 통계청 2018 시군구 경계 (southkorea/southkorea-maps, KOSTAT — 자유 이용)

export const VIEWBOX = '0 0 {round(W)} {height}';

// c: 코드(저장 키) · n: 이름 · s: 시도 · d: SVG path
export const REGIONS = [
{body},
];

// 시도별로 묶어 보여줄 때 쓰는 순서
export const SIDO_ORDER = [{', '.join("'" + v + "'" for v in SIDO.values())}];
'''
    with open(OUT, 'w') as f:
        f.write(js)
    print(f'js/koreamap.js — 지역 {len(regions)}개, {len(js) / 1024:.0f}KB, viewBox 0 0 {round(W)} {height}',
          file=sys.stderr)


main()

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IShardRendererV1 } from "./interfaces/IShardRendererV1.sol";
import { LibString } from "solady/utils/LibString.sol";

/// @notice Immutable stateless on-chain SVG generator. Layered abstract geometry.
/// @dev tokenURI is a view call, so this contract's gas is never paid.
///      All traits are uniformly distributed - deliberately no rarity tiers.
contract GeometricRendererV1 is IShardRendererV1 {
    using LibString for uint256;

    uint256 private constant PALETTES = 16;
    uint256 private constant LAYOUTS = 8;
    uint256 private constant DENSITIES = 6;
    uint256 private constant PRIMITIVES = 6;
    uint256 private constant ROTATIONS = 12;
    uint256 private constant BACKGROUNDS = 8;

    /// @dev 16 palettes x 4 colours x 3 bytes, packed rrggbb.
    bytes private constant PAL = hex"1b1109f2542df7c59fe8871e06202a1b98a07de2d1e8f6ef2b1b2fff4d8dffa5c3ffe06612200f4c934ca3c9a8e9f5db"
        hex"191e334a4e7a9a8fbff2e9e4241b00ffc300ff8c00fff3b00b0b0d4a4a578a8a99f5f5f70f2b36ff6b6bffd93d6bcb77"
        hex"1a0b2e7b2ff7f107a338c6d92e1e17b5651de0a96df5e1c00d1b2a415a77778da9e0e1dd17301ca7c957f2e8cfbc4749"
        hex"2211118c2f0dd95d39f0a8681e12266a3d9ac77dffe0aaff14171c5a6b80c9a227ede6d60012190a7a8f0a939694d2bd";

    /// @dev sin(d) * 1e4 for d = 0..90, one uint16 per degree.
    bytes private constant SIN = hex"000000af015d020b02ba0368041504c30570061c06c80774081f08ca09730a1c0ac40b6c0c120cb8"
        hex"0d5c0e000ea20f430fe31082112011bc125712f01388141e14b3154615d8166816f61782180d1895"
        hex"191c19a11a231aa41b231b9f1c191c921d071d7b1dec1e5b1ec81f321f9a2000206220c32120217c"
        hex"21d4222a227d22ce231c236723af23f52438247824b524ef2527255b258d25bb25e7261026352658"
        hex"2678269526af26c526d926ea26f82702270a270e2710";

    struct Ctx {
        uint256 seed;
        uint256 palette;
        uint256 layout;
        uint256 density;
        uint256 primitive;
        uint256 rotation;
        uint256 background;
        uint256 count;
        uint256 base;
        string c0;
        string c1;
        string c2;
        string c3;
    }

    struct Sh {
        uint256 kind;
        int256 cx;
        int256 cy;
        uint256 r;
        string col;
        string op;
        uint256 ang;
        bool outline;
    }

    /* -------------------------------------------------------------------- */
    /*                                 AXES                                  */
    /* -------------------------------------------------------------------- */

    /// @dev Uniform for any n, unlike `% n`. Requires x in [0, 256).
    function _pick(uint256 x, uint256 n) private pure returns (uint256) {
        return (x * n) >> 8;
    }

    function _axes(uint256 seed)
        private
        pure
        returns (
            uint256 palette,
            uint256 layout,
            uint256 density,
            uint256 primitive,
            uint256 rotation,
            uint256 background
        )
    {
        palette = _pick((seed >> 0) & 0xFF, PALETTES);
        layout = _pick((seed >> 8) & 0xFF, LAYOUTS);
        density = _pick((seed >> 16) & 0xFF, DENSITIES);
        primitive = _pick((seed >> 24) & 0xFF, PRIMITIVES);
        rotation = _pick((seed >> 32) & 0xFF, ROTATIONS);
        background = _pick((seed >> 40) & 0xFF, BACKGROUNDS);
    }

    /// @notice Exposed for analysis and tests: the six independent axes of a seed.
    function axesOf(uint256 seed)
        external
        pure
        returns (
            uint256 palette,
            uint256 layout,
            uint256 density,
            uint256 primitive,
            uint256 rotation,
            uint256 background
        )
    {
        return _axes(seed);
    }

    function _ctx(uint256 seed) private pure returns (Ctx memory c) {
        c.seed = seed;
        (c.palette, c.layout, c.density, c.primitive, c.rotation, c.background) = _axes(seed);
        c.count = [uint256(3), 5, 8, 13, 21, 34][c.density];
        c.base = [uint256(205), 170, 140, 110, 84, 62][c.density];
        c.c0 = _col(c.palette, 0);
        c.c1 = _col(c.palette, 1);
        c.c2 = _col(c.palette, 2);
        c.c3 = _col(c.palette, 3);
    }

    /* -------------------------------------------------------------------- */
    /*                              PRIMITIVES                               */
    /* -------------------------------------------------------------------- */

    function _col(uint256 p, uint256 i) private pure returns (string memory) {
        uint256 o = (p * 4 + i) * 3;
        uint256 v = (uint256(uint8(PAL[o])) << 16) | (uint256(uint8(PAL[o + 1])) << 8) | uint256(uint8(PAL[o + 2]));
        return string(abi.encodePacked("#", LibString.toHexStringNoPrefix(v, 3)));
    }

    function _accent(Ctx memory c, uint256 i) private pure returns (string memory) {
        if (i == 0) return c.c1;
        if (i == 1) return c.c2;
        return c.c3;
    }

    function _u(uint256 v) private pure returns (string memory) {
        return LibString.toString(v);
    }

    function _i(int256 v) private pure returns (string memory) {
        return LibString.toString(v);
    }

    function _sinT(uint256 d) private pure returns (int256) {
        return int256((uint256(uint8(SIN[d * 2])) << 8) | uint256(uint8(SIN[d * 2 + 1])));
    }

    /// @dev sin(deg) scaled by 1e4.
    function _sin(int256 deg) private pure returns (int256) {
        deg = ((deg % 360) + 360) % 360;
        if (deg <= 90) return _sinT(uint256(deg));
        if (deg <= 180) return _sinT(uint256(180 - deg));
        if (deg <= 270) return -_sinT(uint256(deg - 180));
        return -_sinT(uint256(360 - deg));
    }

    function _cos(int256 deg) private pure returns (int256) {
        return _sin(deg + 90);
    }

    function _polar(Sh memory s, uint256 deg) private pure returns (int256 x, int256 y) {
        x = s.cx + (_cos(int256(deg)) * int256(s.r)) / 10_000;
        y = s.cy + (_sin(int256(deg)) * int256(s.r)) / 10_000;
    }

    function _pt(Sh memory s, uint256 deg) private pure returns (string memory) {
        (int256 x, int256 y) = _polar(s, deg);
        return string(abi.encodePacked(_i(x), ",", _i(y)));
    }

    function _op(uint256 i) private pure returns (string memory) {
        if (i == 0) return "0.42";
        if (i == 1) return "0.55";
        if (i == 2) return "0.66";
        if (i == 3) return "0.78";
        if (i == 4) return "0.9";
        return "1";
    }

    /* -------------------------------------------------------------------- */
    /*                               PLACEMENT                               */
    /* -------------------------------------------------------------------- */

    function _cols(uint256 n) private pure returns (uint256 k) {
        k = 1;
        while (k * k < n) ++k;
    }

    function _vary(Ctx memory c, uint256 h) private pure returns (uint256) {
        return (c.base * (75 + _pick((h >> 16) & 0xFF, 60))) / 100;
    }

    function _place(Ctx memory c, uint256 i, uint256 h) private pure returns (int256 cx, int256 cy, uint256 r) {
        uint256 n = c.count;
        int256 jx = int256(_pick(h & 0xFF, 120)) - 60;
        int256 jy = int256(_pick((h >> 8) & 0xFF, 120)) - 60;

        if (c.layout == 0) {
            // grid, centred as a block with the final partial row centred too
            uint256 k = _cols(n);
            uint256 cell = 720 / k;
            uint256 rows = (n + k - 1) / k;
            uint256 row = i / k;
            uint256 inRow = n - row * k;
            if (inRow > k) inRow = k;
            cx = int256(500 - (inRow * cell) / 2 + cell * (i % k) + cell / 2) + jx / 4;
            cy = int256(500 - (rows * cell) / 2 + cell * row + cell / 2) + jy / 4;
            r = (cell * (36 + _pick((h >> 16) & 0xFF, 22))) / 100;
        } else if (c.layout == 1) {
            // radial
            int256 ang = int256((i * 360) / n) + int256(_pick((h >> 24) & 0xFF, 24));
            uint256 rad = 190 + _pick((h >> 8) & 0xFF, 190);
            cx = 500 + (_cos(ang) * int256(rad)) / 10_000;
            cy = 500 + (_sin(ang) * int256(rad)) / 10_000;
            r = _vary(c, h);
        } else if (c.layout == 2) {
            // stack
            cx = 500 + (jx * 5) / 2;
            cy = int256(120 + (760 * i) / (n - 1));
            r = _vary(c, h);
        } else if (c.layout == 3) {
            // scatter
            cx = int256(120 + _pick(h & 0xFF, 760));
            cy = int256(120 + _pick((h >> 8) & 0xFF, 760));
            r = _vary(c, h);
        } else if (c.layout == 4) {
            // arc
            int256 ang = 165 + int256((i * 210) / (n - 1));
            cx = 500 + (_cos(ang) * 340) / 10_000;
            cy = 540 + (_sin(ang) * 340) / 10_000;
            r = (c.base * (55 + (90 * i) / (n - 1))) / 100;
        } else if (c.layout == 5) {
            // nested
            cx = 500 + jx / 3;
            cy = 500 + jy / 3;
            r = (430 * (n - i)) / n;
        } else if (c.layout == 6) {
            // split
            if (i * 2 < n) {
                cx = int256(120 + _pick(h & 0xFF, 360));
                cy = int256(120 + _pick((h >> 8) & 0xFF, 360));
            } else {
                cx = int256(520 + _pick(h & 0xFF, 360));
                cy = int256(520 + _pick((h >> 8) & 0xFF, 360));
            }
            r = _vary(c, h);
        } else {
            // weave
            cx = int256(120 + (760 * i) / (n - 1));
            cy = 500 + (_sin(int256((i * 720) / n)) * 250) / 10_000 + jy / 5;
            r = _vary(c, h);
        }
        if (r < 8) r = 8;
        // keep every centre on-canvas; oversized shapes may still bleed, which reads as intentional cropping
        if (cx < 110) cx = 110;
        if (cx > 890) cx = 890;
        if (cy < 110) cy = 110;
        if (cy > 890) cy = 890;
    }

    /* -------------------------------------------------------------------- */
    /*                             SHAPE EMITTERS                            */
    /* -------------------------------------------------------------------- */

    function _stroke(Sh memory s, uint256 div) private pure returns (string memory) {
        uint256 w = s.r / div;
        if (w < 4) w = 4;
        return string(
            abi.encodePacked(
                '" fill="none" stroke="',
                s.col,
                '" stroke-width="',
                _u(w),
                '" stroke-linecap="round" opacity="',
                s.op,
                '"/>'
            )
        );
    }

    function _fillOrLine(Sh memory s) private pure returns (string memory) {
        if (s.outline) {
            uint256 w = s.r / 7;
            if (w < 3) w = 3;
            return string(
                abi.encodePacked(' fill="none" stroke="', s.col, '" stroke-width="', _u(w), '" opacity="', s.op, '"/>')
            );
        }
        return string(abi.encodePacked(' fill="', s.col, '" opacity="', s.op, '"/>'));
    }

    function _emit(Sh memory s) private pure returns (string memory) {
        if (s.kind == 0) {
            return string(
                abi.encodePacked('<circle cx="', _i(s.cx), '" cy="', _i(s.cy), '" r="', _u(s.r), '"', _fillOrLine(s))
            );
        }
        if (s.kind == 1) {
            return string(
                abi.encodePacked(
                    '<rect x="',
                    _i(s.cx - int256(s.r)),
                    '" y="',
                    _i(s.cy - int256(s.r)),
                    '" width="',
                    _u(s.r * 2),
                    '" height="',
                    _u(s.r * 2),
                    '" transform="rotate(',
                    _u(s.ang),
                    " ",
                    _i(s.cx),
                    " ",
                    _i(s.cy),
                    ')"',
                    _fillOrLine(s)
                )
            );
        }
        if (s.kind == 2) {
            return string(
                abi.encodePacked(
                    '<polygon points="',
                    _pt(s, s.ang + 270),
                    " ",
                    _pt(s, s.ang + 30),
                    " ",
                    _pt(s, s.ang + 150),
                    '"',
                    _fillOrLine(s)
                )
            );
        }
        if (s.kind == 3) {
            return string(
                abi.encodePacked(
                    '<polygon points="',
                    _pt(s, s.ang),
                    " ",
                    _pt(s, s.ang + 60),
                    " ",
                    _pt(s, s.ang + 120),
                    " ",
                    _pt(s, s.ang + 180),
                    " ",
                    _pt(s, s.ang + 240),
                    " ",
                    _pt(s, s.ang + 300),
                    '"',
                    _fillOrLine(s)
                )
            );
        }
        if (s.kind == 4) {
            return string(
                abi.encodePacked(
                    '<path d="M',
                    _pt(s, s.ang),
                    "A",
                    _u(s.r),
                    " ",
                    _u(s.r),
                    " 0 0 1 ",
                    _pt(s, s.ang + 160),
                    _stroke(s, 4)
                )
            );
        }
        (int256 x1, int256 y1) = _polar(s, s.ang);
        (int256 x2, int256 y2) = _polar(s, s.ang + 180);
        return string(
            abi.encodePacked('<line x1="', _i(x1), '" y1="', _i(y1), '" x2="', _i(x2), '" y2="', _i(y2), _stroke(s, 6))
        );
    }

    function _layer(Ctx memory c, bool echo) private pure returns (string memory) {
        bytes memory out;
        for (uint256 i = 0; i < c.count; ++i) {
            uint256 h = uint256(keccak256(abi.encodePacked(c.seed, i)));
            Sh memory s;
            (s.cx, s.cy, s.r) = _place(c, i, h);
            s.kind = c.primitive;
            s.ang = _pick((h >> 40) & 0xFF, 360);
            if (echo) {
                s.col = c.c3;
                s.op = "0.09";
                s.r = (s.r * 148) / 100;
                s.cx -= 20;
                s.cy -= 20;
                s.outline = false;
            } else {
                s.col = _accent(c, _pick((h >> 32) & 0xFF, 3));
                s.op = _op(_pick((h >> 24) & 0xFF, 6));
                s.outline = ((h >> 48) & 1) == 1;
            }
            out = abi.encodePacked(out, _emit(s));
        }
        return string(out);
    }

    /* -------------------------------------------------------------------- */
    /*                              BACKGROUNDS                              */
    /* -------------------------------------------------------------------- */

    function _bg(Ctx memory c) private pure returns (string memory) {
        bytes memory out = abi.encodePacked('<rect width="1000" height="1000" fill="', c.c0, '"/>');
        if (c.background == 1) {
            out = abi.encodePacked(
                out,
                '<defs><linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="',
                c.c1,
                '" stop-opacity="0.85"/><stop offset="1" stop-color="',
                c.c0,
                '" stop-opacity="0"/></linearGradient></defs><rect width="1000" height="1000" fill="url(#bg)"/>'
            );
        } else if (c.background == 2) {
            out = abi.encodePacked(
                out,
                '<defs><radialGradient id="bg" cx="0.5" cy="0.42" r="0.65"><stop offset="0" stop-color="',
                c.c1,
                '" stop-opacity="0.7"/><stop offset="1" stop-color="',
                c.c0,
                '" stop-opacity="0"/></radialGradient></defs><rect width="1000" height="1000" fill="url(#bg)"/>'
            );
        } else if (c.background == 3) {
            out = abi.encodePacked(
                out,
                '<polygon points="0,0 1000,0 0,1000" fill="',
                c.c1,
                '" opacity="0.16"/><polygon points="1000,1000 1000,320 240,1000" fill="',
                c.c2,
                '" opacity="0.1"/>'
            );
        } else if (c.background == 4) {
            for (uint256 k = 1; k <= 7; ++k) {
                out = abi.encodePacked(
                    out,
                    '<circle cx="500" cy="500" r="',
                    _u(k * 82),
                    '" fill="none" stroke="',
                    c.c3,
                    '" stroke-width="2" opacity="0.11"/>'
                );
            }
        } else if (c.background == 5) {
            for (uint256 k = 1; k < 20; ++k) {
                out = abi.encodePacked(
                    out,
                    '<line x1="',
                    _u(k * 50),
                    '" y1="0" x2="',
                    _u(k * 50),
                    '" y2="1000" stroke="',
                    c.c3,
                    '" stroke-width="1" opacity="0.07"/><line x1="0" y1="',
                    _u(k * 50),
                    '" x2="1000" y2="',
                    _u(k * 50),
                    '" stroke="',
                    c.c3,
                    '" stroke-width="1" opacity="0.07"/>'
                );
            }
        } else if (c.background == 6) {
            for (uint256 k = 0; k < 10; ++k) {
                out = abi.encodePacked(
                    out, '<rect x="0" y="', _u(k * 100), '" width="1000" height="50" fill="', c.c1, '" opacity="0.1"/>'
                );
            }
        }
        return string(out);
    }

    function _overlay(Ctx memory c) private pure returns (string memory) {
        bytes memory out;
        if (c.background == 7) {
            out = abi.encodePacked(
                '<defs><radialGradient id="vg" cx="0.5" cy="0.5" r="0.75"><stop offset="0.4" stop-color="#000000"',
                ' stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.8"/></radialGradient></defs>',
                '<rect width="1000" height="1000" fill="url(#vg)"/>'
            );
        }
        return string(
            abi.encodePacked(
                out,
                '<rect x="36" y="36" width="928" height="928" fill="none" stroke="',
                c.c3,
                '" stroke-width="3" opacity="0.28"/>'
            )
        );
    }

    /* -------------------------------------------------------------------- */
    /*                                OUTPUT                                 */
    /* -------------------------------------------------------------------- */

    function generate(uint256 seed) external pure returns (string memory) {
        Ctx memory c = _ctx(seed);
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">',
                _bg(c),
                '<g transform="rotate(',
                _u(c.rotation * 30),
                ' 500 500)">',
                _layer(c, true),
                _layer(c, false),
                "</g>",
                _overlay(c),
                "</svg>"
            )
        );
    }

    function generateDormant(uint256 tokenId) external pure returns (string memory) {
        string memory id = _u(tokenId);
        uint256 len = bytes(id).length;
        uint256 w = 760 / (len * 3 + 1);
        if (w > 70) w = 70;
        if (w < 4) w = 4;
        uint256 gap = w / 2;
        uint256 total = len * w + (len - 1) * gap;
        uint256 x0 = 500 - total / 2;

        bytes memory digits;
        for (uint256 k = 0; k < len; ++k) {
            digits = abi.encodePacked(digits, _digit(uint8(bytes(id)[k]) - 48, x0 + k * (w + gap), 470, w));
        }

        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">',
                "<desc>Dormant #",
                id,
                "</desc>",
                '<rect width="1000" height="1000" fill="#08080A"/>',
                '<rect x="120" y="120" width="760" height="760" fill="none" stroke="#2A2A30" stroke-width="2"',
                ' stroke-dasharray="18 14"/>',
                '<circle cx="500" cy="500" r="300" fill="none" stroke="#1C1C22" stroke-width="2"/>',
                '<circle cx="500" cy="500" r="220" fill="none" stroke="#16161B" stroke-width="2"/>',
                '<g fill="#3A3A44">',
                digits,
                "</g>",
                '<rect x="36" y="36" width="928" height="928" fill="none" stroke="#26262E" stroke-width="3"/>',
                "</svg>"
            )
        );
    }

    /// @dev Seven-segment digit drawn from rects: no fonts, identical in every renderer.
    function _digit(uint256 d, uint256 x, uint256 y, uint256 w) private pure returns (string memory) {
        uint256[10] memory map = [uint256(0x3F), 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
        uint256 m = map[d];
        uint256 h = w * 2;
        uint256 t = w / 6;
        if (t == 0) t = 1;
        uint256 vl = (h - 3 * t) / 2;
        bytes memory out;
        if (m & 1 != 0) out = abi.encodePacked(out, _rect(x + t, y, w - 2 * t, t));
        if (m & 2 != 0) out = abi.encodePacked(out, _rect(x + w - t, y + t, t, vl));
        if (m & 4 != 0) out = abi.encodePacked(out, _rect(x + w - t, y + 2 * t + vl, t, vl));
        if (m & 8 != 0) out = abi.encodePacked(out, _rect(x + t, y + h - t, w - 2 * t, t));
        if (m & 16 != 0) out = abi.encodePacked(out, _rect(x, y + 2 * t + vl, t, vl));
        if (m & 32 != 0) out = abi.encodePacked(out, _rect(x, y + t, t, vl));
        if (m & 64 != 0) out = abi.encodePacked(out, _rect(x + t, y + (h - t) / 2, w - 2 * t, t));
        return string(out);
    }

    function _rect(uint256 x, uint256 y, uint256 w, uint256 h) private pure returns (string memory) {
        return
            string(abi.encodePacked('<rect x="', _u(x), '" y="', _u(y), '" width="', _u(w), '" height="', _u(h), '"/>'));
    }

    /* -------------------------------------------------------------------- */
    /*                              ATTRIBUTES                               */
    /* -------------------------------------------------------------------- */

    function attributes(uint256 seed) external pure returns (string memory) {
        (uint256 p, uint256 l, uint256 d, uint256 pr, uint256 r, uint256 b) = _axes(seed);
        return string(
            abi.encodePacked(
                '[{"trait_type":"Palette","value":"',
                _paletteName(p),
                '"},{"trait_type":"Layout","value":"',
                _layoutName(l),
                '"},{"trait_type":"Density","value":"',
                _densityName(d),
                '"},{"trait_type":"Primitive","value":"',
                _primitiveName(pr),
                '"},{"trait_type":"Rotation","value":"',
                _u(r * 30),
                '"},{"trait_type":"Background","value":"',
                _backgroundName(b),
                '"}]'
            )
        );
    }

    function _paletteName(uint256 i) private pure returns (string memory) {
        string[16] memory n = [
            "Ember",
            "Tidal",
            "Bloom",
            "Moss",
            "Dusk",
            "Solar",
            "Ink",
            "Reef",
            "Vapor",
            "Clay",
            "Arctic",
            "Citrus",
            "Rust",
            "Orchid",
            "Bullion",
            "Marine"
        ];
        return n[i];
    }

    function _layoutName(uint256 i) private pure returns (string memory) {
        string[8] memory n = ["Grid", "Radial", "Stack", "Scatter", "Arc", "Nested", "Split", "Weave"];
        return n[i];
    }

    function _densityName(uint256 i) private pure returns (string memory) {
        string[6] memory n = ["Sparse", "Light", "Balanced", "Dense", "Packed", "Swarm"];
        return n[i];
    }

    function _primitiveName(uint256 i) private pure returns (string memory) {
        string[6] memory n = ["Circle", "Square", "Triangle", "Hexagon", "Arc", "Line"];
        return n[i];
    }

    function _backgroundName(uint256 i) private pure returns (string memory) {
        string[8] memory n = ["Void", "Gradient", "Halo", "Split", "Rings", "Mesh", "Bands", "Vignette"];
        return n[i];
    }
}

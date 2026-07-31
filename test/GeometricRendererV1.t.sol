// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { LibString } from "solady/utils/LibString.sol";
import { GeometricRendererV1 } from "../src/GeometricRendererV1.sol";

contract GeometricRendererV1Test is Test {
    using LibString for string;

    GeometricRendererV1 internal renderer;

    function setUp() public {
        renderer = new GeometricRendererV1();
    }

    function test_producesWellFormedSvg() public view {
        string memory svg = renderer.generate(uint256(keccak256("well-formed")));
        assertTrue(LibString.startsWith(svg, "<svg"), "must start with <svg");
        assertTrue(LibString.endsWith(svg, "</svg>"), "must end with </svg>");
        assertGt(bytes(svg).length, 100, "must be non-trivial");
    }

    /// @dev The namespace is REQUIRED. An SVG loaded as an image (an <img> tag, a CSS
    ///      background, or OpenSea) is parsed as standalone XML, which has no implied
    ///      namespace — without this the document is not SVG and renders as nothing.
    ///      Only inline-in-DOM SVG can omit it, and that is not how this art is consumed.
    function test_svgDeclaresTheSvgNamespace() public view {
        for (uint256 i = 0; i < 32; ++i) {
            string memory svg = renderer.generate(uint256(keccak256(abi.encodePacked("ns", i))));
            assertTrue(
                LibString.contains(svg, 'xmlns="http://www.w3.org/2000/svg"'),
                "generate() lost the SVG namespace - it will render blank as an image"
            );
        }
        assertTrue(
            LibString.contains(renderer.generateDormant(7), 'xmlns="http://www.w3.org/2000/svg"'),
            "generateDormant() lost the SVG namespace"
        );
    }

    /// @dev The previous version of this test asserted the SVG contained no "http" at all,
    ///      as a proxy for "no external dependencies". That banned the namespace declaration
    ///      above and shipped a blank collection. Check for actual external references
    ///      instead: a fetched resource is `<image`, `href=`, or `url(http…)`.
    function test_noExternalReferences() public view {
        for (uint256 i = 0; i < 64; ++i) {
            string memory svg = renderer.generate(uint256(keccak256(abi.encodePacked("ext", i))));
            assertFalse(LibString.contains(svg, "<image"), "no image tags");
            assertFalse(LibString.contains(svg, "href="), "no hrefs");
            assertFalse(LibString.contains(svg, "url(http"), "no external url() references");
            // The ONLY permitted http occurrence is the namespace identifier.
            assertEq(
                LibString.indexOf(svg, "http"),
                LibString.indexOf(svg, 'xmlns="http://www.w3.org/2000/svg"') + 7,
                "an http reference appeared outside the xmlns declaration"
            );
        }
        string memory dormant = renderer.generateDormant(7);
        assertFalse(LibString.contains(dormant, "<image"), "dormant: no image tags");
        assertFalse(LibString.contains(dormant, "href="), "dormant: no hrefs");
    }

    function test_differentSeedsProduceDifferentArt() public view {
        string memory a = renderer.generate(1);
        string memory b = renderer.generate(2);
        string memory c = renderer.generate(type(uint256).max);
        assertTrue(keccak256(bytes(a)) != keccak256(bytes(b)), "1 vs 2");
        assertTrue(keccak256(bytes(b)) != keccak256(bytes(c)), "2 vs max");
        assertTrue(keccak256(bytes(a)) != keccak256(bytes(c)), "1 vs max");
    }

    function test_sameSeedIsDeterministic() public view {
        uint256 seed = uint256(keccak256("determinism"));
        assertEq(renderer.generate(seed), renderer.generate(seed));
        assertEq(renderer.attributes(seed), renderer.attributes(seed));
        assertEq(renderer.generateDormant(42), renderer.generateDormant(42));
    }

    function test_dormantIsDistinctFromLive() public view {
        string memory dormant = renderer.generateDormant(99);
        string memory live = renderer.generate(99);
        assertTrue(keccak256(bytes(dormant)) != keccak256(bytes(live)), "dormant != live");
        assertTrue(LibString.startsWith(dormant, "<svg"), "dormant is an svg");
        assertTrue(LibString.endsWith(dormant, "</svg>"), "dormant closes");
        assertTrue(LibString.contains(dormant, "99"), "dormant shows the token id");
        assertTrue(
            keccak256(bytes(renderer.generateDormant(99))) != keccak256(bytes(renderer.generateDormant(100))),
            "dormant varies by id"
        );
    }

    function test_attributesAreValidJsonFragment() public view {
        string memory json = renderer.attributes(uint256(keccak256("attrs")));
        assertTrue(LibString.startsWith(json, "["), "starts with [");
        assertTrue(LibString.endsWith(json, "]"), "ends with ]");
        assertTrue(LibString.contains(json, "trait_type"), "has trait_type");
        assertTrue(LibString.contains(json, "Palette"), "has Palette axis");
        assertTrue(LibString.contains(json, "Layout"), "has Layout axis");
        assertTrue(LibString.contains(json, "Density"), "has Density axis");
        assertTrue(LibString.contains(json, "Primitive"), "has Primitive axis");
        assertTrue(LibString.contains(json, "Rotation"), "has Rotation axis");
        assertTrue(LibString.contains(json, "Background"), "has Background axis");
    }

    function test_traitsAreFlat() public view {
        uint256 samples = 4000;
        uint256[16] memory palettes;
        uint256[8] memory layouts;
        uint256[6] memory densities;
        uint256[6] memory primitives;
        uint256[12] memory rotations;
        uint256[8] memory backgrounds;

        for (uint256 i = 0; i < samples; ++i) {
            uint256 seed = uint256(keccak256(abi.encodePacked("flat", i)));
            (uint256 p, uint256 l, uint256 d, uint256 pr, uint256 r, uint256 b) = renderer.axesOf(seed);
            palettes[p]++;
            layouts[l]++;
            densities[d]++;
            primitives[pr]++;
            rotations[r]++;
            backgrounds[b]++;
        }

        for (uint256 i = 0; i < 16; ++i) {
            assertGt(palettes[i], 0, "every palette index must appear");
        }
        for (uint256 i = 0; i < 8; ++i) {
            assertGt(layouts[i], 0, "every layout index must appear");
            assertGt(backgrounds[i], 0, "every background index must appear");
        }
        for (uint256 i = 0; i < 6; ++i) {
            assertGt(densities[i], 0, "every density index must appear");
            assertGt(primitives[i], 0, "every primitive index must appear");
        }
        for (uint256 i = 0; i < 12; ++i) {
            assertGt(rotations[i], 0, "every rotation index must appear");
        }

        // Flatness: with 4000 samples no bucket should deviate wildly from its
        // expected share. Expected for 12 buckets is ~333; allow a wide band that
        // a `% 12` bias (which would skew the first 4 buckets by ~33%) would fail.
        for (uint256 i = 0; i < 12; ++i) {
            assertGt(rotations[i], (samples / 12) * 8 / 10, "rotation bucket too small");
            assertLt(rotations[i], (samples / 12) * 12 / 10, "rotation bucket too large");
        }
    }

    function testFuzz_neverReverts(uint256 seed) public view {
        string memory svg = renderer.generate(seed);
        assertTrue(LibString.startsWith(svg, "<svg"));
        assertTrue(LibString.endsWith(svg, "</svg>"));
        string memory json = renderer.attributes(seed);
        assertTrue(LibString.startsWith(json, "["));
        assertTrue(LibString.endsWith(json, "]"));
        string memory dormant = renderer.generateDormant(seed);
        assertTrue(LibString.endsWith(dormant, "</svg>"));
    }
}

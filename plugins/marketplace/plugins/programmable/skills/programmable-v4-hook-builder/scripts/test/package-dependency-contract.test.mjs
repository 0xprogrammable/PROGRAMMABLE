import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExternalPackageBinding,
  isCanonicalNpmPackageName,
  isExactDeclaredPackageSpecifier,
  isExactPackageDependency,
  isExternalPackageReviewRecord
} from "../package-dependency-contract.mjs";

const integrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

test("canonical npm package names cover unscoped, scoped and documented URL-safe forms", () => {
  for (const packageName of [
    "three",
    "playwright-core",
    "package.name_with~safe-chars",
    "@react-three/fiber",
    "@scope/.private-name",
    "@scope/_private-name",
    "@.scope/pkg",
    "@_scope/pkg~variant"
  ]) assert.equal(isCanonicalNpmPackageName(packageName), true, packageName);
});

test("invalid or ambiguous npm package names fail closed", () => {
  for (const packageName of [
    "Three",
    ".unscoped",
    "_unscoped",
    "three@npm:other",
    "three%2fother",
    "three\\other",
    "@scope",
    "@scope/",
    "@scope/pkg/extra",
    "@./pkg",
    "@scope/..",
    "a".repeat(215)
  ]) assert.equal(isCanonicalNpmPackageName(packageName), false, packageName);
});

test("declared package specifiers accept only the exact package root and safe subpaths", () => {
  assert.equal(isExactDeclaredPackageSpecifier("three", "three"), true);
  assert.equal(isExactDeclaredPackageSpecifier("three/addons/loaders/GLTFLoader.js", "three"), true);
  assert.equal(isExactDeclaredPackageSpecifier("@react-three/fiber/native", "@react-three/fiber"), true);
  for (const specifier of [
    "three-other",
    "three/../other",
    "three//other",
    "three/./other",
    "three/addons%2fother",
    "three?mode=other",
    "@react-three/fiber-other"
  ]) assert.equal(isExactDeclaredPackageSpecifier(specifier, "three"), false, specifier);
});

test("generic package source provenance is an optional all-or-nothing pair", () => {
  const base = { packageName: "three", version: "0.185.1", integrity };
  assert.equal(isExactPackageDependency({ ...base, repository: null, revision: null }), true);
  assert.equal(isExactPackageDependency({
    ...base,
    repository: "https://github.com/mrdoob/three.js",
    revision: "2".repeat(40)
  }), true);
  assert.equal(isExactPackageDependency({ ...base, repository: null, revision: "2".repeat(40) }), false);
  assert.equal(isExactPackageDependency({ ...base, repository: "http://example.com/three", revision: "2".repeat(40) }), false);
  assert.equal(isExactPackageDependency({ ...base, version: "0.185.1-canary.1+build.7", repository: null, revision: null }), true);
});

test("official Uniswap packages retain the official source rule", () => {
  const base = {
    packageName: "@uniswap/v4-sdk",
    version: "2.3.1",
    integrity,
    revision: "3".repeat(40)
  };
  assert.equal(isExactPackageDependency({ ...base, repository: "https://github.com/Uniswap/sdks.git" }), true);
  assert.equal(isExactPackageDependency({ ...base, repository: "https://github.com/example/sdks.git" }), false);
  assert.equal(isExactPackageDependency({ ...base, repository: null, revision: null }), false);
  assert.equal(isExactPackageDependency({
    ...base,
    packageName: "@uniswap/v4-core",
    repository: "https://github.com/Uniswap/v4-core",
    revision: "3".repeat(40)
  }), true);
});

test("external package review records are explicit local evidence, not central source verification", () => {
  const dependency = {
    packageName: "@openzeppelin/contracts",
    version: "5.6.1",
    integrity,
    repository: "https://github.com/OpenZeppelin/openzeppelin-contracts",
    revision: "4".repeat(40)
  };
  const record = {
    path: "node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol",
    kind: "solidity-package-dependency-import",
    sourceClass: "external-package-local",
    packageDependency: buildExternalPackageBinding(dependency)
  };
  assert.equal(isExternalPackageReviewRecord(record), true);
  assert.equal(record.packageDependency.centralSourceVerified, false);
  assert.equal(record.packageDependency.integrityVerified, false);
  assert.equal(isExternalPackageReviewRecord({ ...record, path: "node_modules/@openzeppelin/other/IERC20.sol" }), false);
});

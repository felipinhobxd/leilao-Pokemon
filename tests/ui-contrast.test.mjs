import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const batch = readFileSync(new URL("../app/auctions/new/batch-wizard.css", import.meta.url), "utf8");
const wizard = readFileSync(new URL("../app/auctions/new/wizard.css", import.meta.url), "utf8");

function values(name) {
  return [...globals.matchAll(new RegExp(`--${name}:(#[0-9a-fA-F]{6})`, "g"))].map(match => match[1]);
}

function luminance(hex) {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function assertThemePair(textToken, backgroundToken, label) {
  const texts = values(textToken), backgrounds = values(backgroundToken);
  assert.ok(texts.length >= 2 && backgrounds.length >= 2, `${label}: dark and light tokens must exist`);
  for (const [index, theme] of ["dark", "light"].entries()) {
    assert.ok(contrast(texts[index], backgrounds[index]) >= 4.5, `${label} ${theme} contrast must meet WCAG AA`);
  }
}

test("poll value chips keep readable token-based colors and wrap instead of clipping", () => {
  assert.match(batch, /\.poll-mini\{[^}]*flex-wrap:wrap[^}]*\}/s);
  assert.match(batch, /\.poll-mini span\{[^}]*background:var\(--chip-bg\)[^}]*color:var\(--chip-text\)[^}]*\}/s);
  assert.doesNotMatch(batch, /\.poll-mini span\{[^}]*background:#eef2f7[^}]*\}/s);
  assert.match(wizard, /\.poll-chip-list[^\{]*\{[^}]*flex-wrap:wrap[^}]*\}/s);
});

test("auction controls expose stable touch, focus, selected and disabled states", () => {
  assert.match(globals, /button,.button-link\{[^}]*min-height:44px[^}]*\}/s);
  assert.match(globals, /button:disabled\{[^}]*opacity:1[^}]*background:var\(--disabled-bg\)[^}]*color:var\(--disabled-text\)[^}]*\}/s);
  assert.match(globals, /button:focus-visible[^\{]*\{[^}]*outline:3px solid var\(--focus-ring\)[^}]*\}/s);
  assert.match(wizard, /\.radio-row:has\(input:checked\)\{[^}]*background:var\(--accent-soft\)[^}]*box-shadow:[^}]*var\(--accent\)[^}]*\}/s);
  assert.match(wizard, /\.radio-row:has\(input:disabled\)\{[^}]*background:var\(--disabled-bg\)[^}]*cursor:not-allowed[^}]*\}/s);
});

test("dark and light auction states meet WCAG AA text contrast", () => {
  assertThemePair("chip-text", "chip-bg", "normal chip");
  assertThemePair("disabled-text", "disabled-bg", "disabled control");
  assertThemePair("accent-soft-text", "accent-soft", "selected control");
});

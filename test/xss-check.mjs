// node test/xss-check.mjs — proves the h`` template escapes untrusted data by default and
// only emits raw markup for explicitly-branded (Safe) fragments. Guards the stored-XSS fix.
import assert from 'node:assert/strict';
import { h, raw, esc, Safe, ICONS } from '../js/util.js';

const html = v => String(v); // Safe -> its string

// --- attack payloads an attacker could put in a payee name / memo / imported field ---
const IMG = '<img src=x onerror=alert(1)>';
const SCRIPT = '<script>alert(1)</script>';
const CLOSE = '</td><script>alert(1)</script><td>';       // tries to break out of a cell
const ATTR = '"><img src=x onerror=alert(1)>';            // tries to break out of an attribute

// 1. A fragment-shaped user value (starts "<", ends ">") must be ESCAPED, not passed raw.
//    This is the exact bypass the old content-sniffing h() allowed.
for (const payload of [IMG, SCRIPT, CLOSE, ATTR]) {
  const out = html(h`<td>${payload}</td>`);
  assert.ok(!out.includes(payload), `payload leaked raw: ${payload}`);
  assert.ok(!/<img|<script/i.test(out), `live tag survived: ${out}`);
  assert.ok(out.includes('&lt;'), `expected escaped output for: ${payload}`);
}

// 2. Escaped inside an attribute context too (quotes neutralized).
{
  const out = html(h`<a title="${ATTR}">x</a>`);
  assert.ok(!out.includes('"><img'), 'attribute breakout not neutralized');
  assert.ok(out.includes('&quot;') && out.includes('&lt;img'), 'attr payload not escaped');
}

// 3. raw() is an explicit opt-in: developer-authored markup passes through.
{
  const out = html(h`<div>${raw('<span class="badge">OK</span>')}</div>`);
  assert.equal(out, '<div><span class="badge">OK</span></div>');
}

// 4. Nested h`` results are Safe and pass through; their inner user data stays escaped.
{
  const cell = h`<td>${IMG}</td>`;
  assert.ok(cell instanceof Safe, 'h must return a Safe');
  const out = html(h`<tr>${cell}</tr>`);
  assert.equal(out, `<tr><td>${esc(IMG)}</td></tr>`);
  assert.ok(!/<img/i.test(out));
}

// 5. Arrays: Safe/nested-h elements pass raw; plain-string elements are escaped.
{
  const out = html(h`<ul>${[h`<li>a</li>`, raw('<li>b</li>')]}</ul>`);
  assert.equal(out, '<ul><li>a</li><li>b</li></ul>');
  const out2 = html(h`<ul>${[IMG]}</ul>`);           // plain string in array -> escaped
  assert.ok(!/<img/i.test(out2), 'array plain-string element must be escaped');
}

// 6. ICONS are branded Safe (so all icon interpolations keep rendering).
{
  assert.ok(ICONS.plan instanceof Safe, 'ICONS.* must be Safe');
  const out = html(h`<span>${ICONS.plan}</span>`);
  assert.ok(out.includes('<svg'), 'icon svg must render raw');
}

// 7. null / undefined / false render as empty (not the string "null"/"false").
{
  assert.equal(html(h`<b>${null}${undefined}${false}</b>`), '<b></b>');
  assert.equal(html(h`<b>${0}</b>`), '<b>0</b>'); // 0 must still render
}

console.log('xss-check: all assertions passed');

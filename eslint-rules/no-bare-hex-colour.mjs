/**
 * Flag a bare hex literal used as a TEXT colour, AND flag a hardcoded
 * background/border colour that sits under a tokenized text colour on the
 * same element.
 *
 * WHY THIS EXISTS. Three hardcoded colours (#48484a, #9ca3af, #f0c070) failed
 * WCAG SC 1.4.3 and cost the 2026-08-08 release three ~40-minute CI cycles. All
 * three were in components rather than stylesheets, so every sweep of
 * globals.css missed them, and two of the three sat in `neutral` branches that
 * only render when the market is neither bullish nor bearish.
 *
 * That is the argument for a lint rule over a test: the contrast sweep can only
 * see a colour when a route happens to render the state containing it, so it
 * finds these when the market cooperates. This finds them when the line is
 * typed. Issue #110.
 *
 * SCOPE WAS ORIGINALLY TEXT ONLY (#110), on the reasoning that "a hardcoded
 * background is a design choice, while a hardcoded text colour is the thing
 * that fails in one theme and passes in the other." #572 falsified that: two
 * real defects (#570's heatmap, 1.66:1, the worst contrast measured anywhere
 * on the platform; the /arena LIVE pill) were both a hardcoded BACKGROUND
 * under a correctly TOKENIZED text colour. That pairing is invisible to a
 * text-only rule, and worse than the case the rule already caught - a
 * hardcoded text colour is visible in review as a hardcoded text colour, but
 * a hardcoded background under `color: var(--txt3)` looks correct, because
 * the reviewer sees a token and moves on. The token moves per theme, the
 * literal does not, and nobody measures the composited pair.
 *
 * So the rule now also flags a hardcoded background/border colour on any
 * object literal that also sets a tokenized text colour - the shape both
 * defects actually had. It does NOT flag a fully-hardcoded object (background
 * and text both literal): that may be a legitimate fixed island (a badge
 * meant to look the same regardless of theme), which is a design question,
 * not this rule's to answer. Widening to hardcoded backgrounds in general is
 * still out of scope - that is where the "~34 sites, no accessibility value"
 * estimate lives, and most of those sites are exactly this kind of
 * intentional fixed island.
 *
 * Gradients need no special case for the TEXT check: `linear-gradient(160deg,
 * #d8dee9,#9ca3af)` is not a bare colour literal, so COLOUR_LITERAL never
 * whole-string-matches it. The SURFACE check does look inside a border
 * shorthand string (`'0.5px solid #2a4a7a'`) for an embedded colour, since
 * that is the actual shape #572's second example used.
 */

/**
 * A whole-string hardcoded colour of any common CSS shape - hex, rgb()/rgba(),
 * hsl()/hsla(), or the `color(...)` function a browser serializes color-mix()
 * output as. #572: BARE_HEX alone missed #570's `rgba(52,211,153,0.45)` and
 * #569's `color(srgb ... / 0.13)` on the text side; this is the widened
 * pattern for both the text check and the surface-pairing check below.
 */
const COLOUR_LITERAL =
  /^(?:#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\([^)]*\)|hsla?\([^)]*\)|color\([^)]*\))$/;

/** The same shapes as COLOUR_LITERAL, but not anchored - for pulling a colour
 *  out of a shorthand string like `'0.5px solid #2a4a7a'`. Deliberately not
 *  used for the text check: an unanchored match on `linear-gradient(...)`
 *  would misfire on every stop, which is exactly what BARE_HEX's anchoring
 *  exists to prevent. Only the surface/border check below uses this. */
const EMBEDDED_COLOUR =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|color\([^)]*\)/;

/** Object keys that put a hardcoded value on a BACKGROUND or BORDER surface.
 *  `bg` is here deliberately, not as a guessed abbreviation - it is this
 *  codebase's own established shorthand for the exact same signal-object
 *  shape as the two #572 defects (`{ color, bg }`, 19 files use it), not a
 *  hypothetical one. */
const SURFACE_COLOUR_KEYS = new Set([
  'background', 'backgroundColor', 'bg',
  'border', 'borderColor', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight',
]);

/** True if the token-adjacent value looks like it came from a theme token
 *  rather than a hardcoded literal - a `var(--x)` string/template, or a call
 *  (withAlpha(...), a colour-mix helper, cellColor(...)) whose whole point is
 *  to resolve a token at runtime. Deliberately permissive on calls: this rule
 *  cannot evaluate what a function returns, and treating every call as
 *  "probably a token" is the same choice #570/the arena pill's own authors
 *  made correctly for the text side - it is the background side that needs
 *  catching, not this. */
function looksLikeToken(valueNode) {
  if (!valueNode) return false;
  if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
    return valueNode.value.includes('var(--');
  }
  if (valueNode.type === 'TemplateLiteral') {
    return valueNode.expressions.length > 0
      || valueNode.quasis.some(q => q.value.raw.includes('var(--'));
  }
  if (valueNode.type === 'CallExpression' || valueNode.type === 'ConditionalExpression') {
    return true;
  }
  return false;
}

/** The hardcoded colour literal inside a surface/border value, or null if the
 *  value isn't a hardcoded literal at all (a token, a call, a variable). */
function hardcodedSurfaceColour(valueNode) {
  if (!valueNode || valueNode.type !== 'Literal' || typeof valueNode.value !== 'string') return null;
  const raw = valueNode.value;
  if (COLOUR_LITERAL.test(raw)) return raw;
  const embedded = raw.match(EMBEDDED_COLOUR);
  return embedded ? embedded[0] : null;
}

/**
 * `sigCol`, `leanColor`, `statusCol`, `biasCol`, or the bare word `color`.
 *
 * The camelCase boundary is load-bearing. A plain /col(our|or)?$/i also matches
 * `protocol`, which ends in "col" and is not a colour - caught while testing
 * this rule rather than after it started warning about someone's URL handling.
 * So: an uppercase C preceded by a lowercase character, or the whole identifier
 * being the word itself.
 */
const COLOUR_IDENTIFIER = /(?:[a-z0-9_]Col(?:our|or)?|^col(?:our|or)?)$/;

/** Object keys that put a value on TEXT. `borderColor` is a border, not text. */
const TEXT_COLOUR_KEYS = new Set(['color', 'textColor', 'colour']);

function keyNameOf(property) {
  if (!property || property.type !== 'Property') return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal') return String(property.key.value);
  return null;
}

/**
 * Is this literal being used as a text colour?
 *
 * Two shapes, both taken from real failures in this repo:
 *   { color: '#9ca3af' }                    - inline style / style object
 *   const leanColor = cond ? tok : '#9ca3af' - a colour-named binding
 *
 * The second walks up through ConditionalExpression and LogicalExpression
 * because that is how every one of these was actually written - the token
 * branches were already migrated and the fallback was left behind.
 */
function textColourContext(node) {
  let current = node;
  let parent = current.parent;

  while (parent) {
    if (parent.type === 'Property' && parent.value === current) {
      return TEXT_COLOUR_KEYS.has(keyNameOf(parent)) ? 'property' : null;
    }
    if (parent.type === 'VariableDeclarator' && parent.init === current) {
      return parent.id.type === 'Identifier' && COLOUR_IDENTIFIER.test(parent.id.name)
        ? 'binding' : null;
    }
    if (parent.type === 'AssignmentExpression' && parent.right === current) {
      return parent.left.type === 'Identifier' && COLOUR_IDENTIFIER.test(parent.left.name)
        ? 'binding' : null;
    }
    // Keep climbing only through the shapes a colour choice is written in.
    // Anything else (a call argument, an array, a return) is not something this
    // rule claims to understand, so it stops rather than guessing.
    if (parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression') {
      current = parent;
      parent = parent.parent;
      continue;
    }
    return null;
  }
  return null;
}

/** `cellBg`, `statusBg`, `badgeBackground`, or the bare word `bg`/`background`.
 *  Mirrors COLOUR_IDENTIFIER's convention, for the same reason: a plain
 *  /bg$/i also matches things like `debug`, so the boundary is load-bearing
 *  here too. */
const SURFACE_IDENTIFIER = /(?:[a-z0-9_](?:Bg|Background|Fill)|^bg|^background|^fill)$/;

/** Walks up from a Function node to the name it was actually declared or
 *  assigned under - `function cellBg(...)`, `const cellBg = (...) => ...`,
 *  or `{ cellBg: (...) => ... }`. Returns null for an anonymous function this
 *  rule has no name to test (an inline callback, for instance) - deliberately
 *  conservative, since a name-based check with no name to check is a guess. */
function enclosingFunctionName(node) {
  let n = node;
  while (n) {
    if (n.type === 'FunctionDeclaration' && n.id) return n.id.name;
    if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      const p = n.parent;
      if (p && p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
      if (p && p.type === 'Property' && p.key.type === 'Identifier') return p.key.name;
    }
    n = n.parent;
  }
  return null;
}

/**
 * Is this the return value of a function whose name says it computes a
 * background/surface colour? `function cellBg(r, diag) { ... return
 * `rgba(52,211,153,${a})`; }` is exactly how #570's heatmap tint was written
 * - the hardcoded value never touches an object literal at all, so the
 * ObjectExpression pairing check below cannot see it. Walks up through
 * ConditionalExpression/LogicalExpression like textColourContext, plus an
 * arrow function's implicit-return body (`(r) => cond ? a : b`, no
 * ReturnStatement node to find).
 */
function surfaceFunctionReturnContext(node) {
  let current = node;
  let parent = current.parent;

  while (parent) {
    if (parent.type === 'ReturnStatement' && parent.argument === current) {
      const fnName = enclosingFunctionName(parent);
      return fnName && SURFACE_IDENTIFIER.test(fnName) ? fnName : null;
    }
    if (parent.type === 'ArrowFunctionExpression' && parent.body === current) {
      const fnName = enclosingFunctionName(parent);
      return fnName && SURFACE_IDENTIFIER.test(fnName) ? fnName : null;
    }
    if (parent.type === 'ConditionalExpression' || parent.type === 'LogicalExpression') {
      current = parent;
      parent = parent.parent;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * A template literal that is building a hardcoded colour string - the static
 * (non-interpolated) parts start with a colour-function opener or a hex `#`,
 * and none of them mention a token. `` `rgba(52,211,153,${a})` `` matches;
 * `` `${withAlpha(x, '44')}` `` and `` `var(--green)` `` do not - the first
 * has no static colour-looking prefix, the second names a token outright.
 */
function templateLooksHardcodedColour(node) {
  if (node.type !== 'TemplateLiteral') return false;
  if (node.quasis.some(q => q.value.raw.includes('var(--'))) return false;
  return /^\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|color\()/.test(node.quasis[0].value.raw);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use a theme token instead of a bare hex literal for text colour, so the value adapts to light and dark',
    },
    schema: [],
    messages: {
      bareHex:
        "Bare colour '{{hex}}' as a text colour. Hardcoded colours do not adapt to theme - this is how #9ca3af " +
        'shipped at 2.54:1 in light mode. Use a token such as var(--txt), var(--txt2), var(--txt3) or ' +
        'var(--amber). If the colour genuinely cannot be a token, disable this line with a comment saying why.',
      hardcodedSurface:
        "Hardcoded {{key}} '{{hex}}' under a tokenized text colour. The text adapts to theme, this background " +
        "doesn't, so the pair is never measured together - this is how #570's heatmap shipped at 1.66:1 and the " +
        "/arena LIVE pill shipped at 2.70:1. Use a token, or color-mix()/withAlpha() derived from one, so the " +
        'pair moves together. If this is a genuinely fixed island regardless of theme, disable this line with a ' +
        'comment saying so.',
      hardcodedSurfaceFn:
        "Hardcoded colour '{{hex}}' returned from {{fn}}(), a name that says it computes a background/surface " +
        "colour. This is exactly how #570's cellBg() shipped its heatmap tint at 1.66:1 - the hardcoded value " +
        'never touched an object literal, so nothing paired it with the text colour it sits under. Use a token, ' +
        'or color-mix()/withAlpha() derived from one. If this is genuinely a fixed value regardless of theme, ' +
        'disable this line with a comment saying so.',
    },
  },

  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (!COLOUR_LITERAL.test(node.value)) return;
        if (textColourContext(node)) {
          context.report({ node, messageId: 'bareHex', data: { hex: node.value } });
          return;
        }
        const fnName = surfaceFunctionReturnContext(node);
        if (fnName) {
          context.report({ node, messageId: 'hardcodedSurfaceFn', data: { hex: node.value, fn: fnName } });
        }
      },

      TemplateLiteral(node) {
        if (!templateLooksHardcodedColour(node)) return;
        const fnName = surfaceFunctionReturnContext(node);
        if (fnName) {
          const preview = node.quasis.map(q => q.value.raw).join('${…}');
          context.report({ node, messageId: 'hardcodedSurfaceFn', data: { hex: preview, fn: fnName } });
        }
      },

      // #572: the paired check. Runs on every object literal (a style={{}}
      // object, most of the time) - if it sets a tokenized text colour AND a
      // hardcoded background/border, the background is the defect. Does NOT
      // fire when text is ALSO hardcoded (a fully-fixed object) - that shape
      // is a design question this rule isn't equipped to answer, per #572's
      // own scope note.
      ObjectExpression(node) {
        let textValue = null;
        const surfaceProps = [];

        for (const prop of node.properties) {
          if (prop.type !== 'Property') continue;
          const key = keyNameOf(prop);
          if (!key) continue;
          if (TEXT_COLOUR_KEYS.has(key)) {
            textValue = prop.value;
          } else if (SURFACE_COLOUR_KEYS.has(key)) {
            surfaceProps.push({ key, value: prop.value });
          }
        }

        if (!looksLikeToken(textValue)) return;

        for (const { key, value } of surfaceProps) {
          const hardcoded = hardcodedSurfaceColour(value);
          if (!hardcoded) continue;
          context.report({ node: value, messageId: 'hardcodedSurface', data: { key, hex: hardcoded } });
        }
      },
    };
  },
};

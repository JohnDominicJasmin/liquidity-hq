/**
 * Flag a bare hex literal used as a TEXT colour.
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
 * SCOPE IS DELIBERATELY TEXT ONLY. `background`, `border`, `fill` and `stroke`
 * are not flagged - a hardcoded background is a design choice, while a
 * hardcoded text colour is the thing that fails in one theme and passes in the
 * other. Widening this would add ~34 sites and no accessibility value.
 *
 * Gradients need no special case: `linear-gradient(160deg,#d8dee9,#9ca3af)` is
 * not a bare hex literal, so the pattern below never matches it.
 */

/** A whole-string hex colour. Anchored, so `linear-gradient(...#abc...)` is out. */
const BARE_HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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
        "Bare hex '{{hex}}' as a text colour. Hardcoded colours do not adapt to theme - this is how #9ca3af " +
        'shipped at 2.54:1 in light mode. Use a token such as var(--txt), var(--txt2), var(--txt3) or ' +
        'var(--amber). If the colour genuinely cannot be a token, disable this line with a comment saying why.',
    },
  },

  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== 'string' || !BARE_HEX.test(node.value)) return;
        if (!textColourContext(node)) return;
        context.report({ node, messageId: 'bareHex', data: { hex: node.value } });
      },
    };
  },
};

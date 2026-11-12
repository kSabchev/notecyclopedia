/**
 * How every AI feature writes math, so text saved to pages reads well. Whatever slips through is fixed when it is
 * saved (see `tidyLatex` and `markdownBlocks` in @nc/shared).
 */
export const MATH_STYLE =
  'Math: write symbols and short expressions inline as $…$ and each displayed equation as $$…$$ on its own line. Put word subscripts and superscripts in \\text{…} (v_{\\text{esc}}, a_{\\text{par}}, T_{\\text{max}}; not v_{esc}); single letters and indices stay as they are (a_p, a_{ij}). Use \\cdot for multiplication, no \\displaystyle, and keep sentences outside math.'

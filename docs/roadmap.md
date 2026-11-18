# Roadmap

Notecyclopedia is first a personal study assistant and tutor; hosting it for others comes later. Every item follows
the four rules in the [README](../README.md): help on request, tutor before solver, compute, don't guess, and keep what
you paid for.

How each finished feature works is in the [user guide](guide.md).

## Next up

1. **One session against real Claude:** the tutor, an exam plan and a quick check, with the time to the first token. The
   tests mock every AI call, so this is the only check of real answers; it costs a few cents. Fix what it shows.
2. **Practice problems from calculators** (no AI).
3. **Phone-width check**, before more screens are added.
4. **Exam formula sheet**, then **lecture-aware plans**.
5. **MCP server**, so Claude Desktop or Claude Code can use your notes and calculators on your Claude plan instead of
   the app's API credits.
6. **Transfer diagram with TLE import.**

Then the lecture card actions (*Quiz me on this lecture*, *Article from the original*) and the rest of exam prep.
Workspace packages and subject packs wait until something outside the app needs them; hosting comes later.

## Who it helps

The open items, by the people they are for. Practice problems from calculators serve all four, which is why they come
first after the real-Claude session.

- **A new student** meeting the subject: the notation sheet, the *Start here* course view, prerequisites on a page,
  step-through worked examples and course packs.
- **A graduating student** (finals, thesis): the exam formula sheet, lecture-aware plans, time per task, past exams,
  practice problems, page export to LaTeX or Markdown, a reference list from uploads, the transfer diagram and TLE
  import, and a readable export of all notes.
- **A teaching assistant** (seminars, grading): problem variants with an answer key, handouts with a separate solutions
  sheet, common-mistakes notes, and (once hosted) checks of submitted answers.
- **A professor** (course owner): course packs, presentation mode, exam variants, the notation consistency check,
  Review & polish for lecture notes (done), and (once hosted) which pages students ask about most.

## Open

### Orbits

- [ ] **Transfer diagram**, separate from the orbit diagram: two circular orbits and the Hohmann transfer between them
      at a sensible scale, a spacecraft flying it with both burns, and the phase angle for meeting a target. Its numbers
      come from the built-in `HOHMANN_CALCULATOR` (Δv of both burns and transfer time, checked against Curtis Ex. 6.1).
- [ ] **TLE import:** paste a two-line element set (for example from CelesTrak) and see the satellite's orbit and ground
      track in the orbit viewer; built together with the transfer diagram.

### Lectures and exam prep

- [ ] **Article from the original:** start Create wiki article from a lecture card whose original has no article yet.
      Verify PDF-to-article generation on the PDF that failed before, and add a regression fixture if it reproduces.
- [ ] ***Quiz me on this lecture*** on a lecture card: a quick check with the lecture's pages as the source, only when
      clicked.
- [ ] **Lecture-aware plans:** scope a plan by lectures ("Lectures 1–6") instead of a page list, and show each day's
      lecture with its original, pages and example problems.
- [ ] **Use what the app knows** when proposing a plan: pages you asked about most and pages you barely opened go into
      the same call, at no extra cost.
- [ ] **Time per task:** estimate minutes from a page's length and formulas, and show each day's load against the
      minutes a day.
- [ ] **One-click task actions:** open the page, *Quiz me on this*, or ask the tutor with the page as the source; AI only
      when clicked.
- [ ] **Exam formula sheet:** the key and pinned formulas of the pages in scope, grouped by lecture, printable (no AI).
- [ ] **Past exams:** upload a past exam, tag each problem with its lecture and link it to the calculator that solves
      it; a view of which lectures past exams drew on most (no AI).
- [ ] ***Start here* view of a course:** the lectures in order, with each one's key formulas and terms, built from the
      headings, terms and backlinks the app already has (no AI).
- [ ] **Prerequisites on a page:** "builds on…", from the page's existing references, so a newcomer knows what to read
      first.

### Practice and teaching

- [ ] **Practice problems from calculators** (no AI): random inputs within a calculator's min and max make "a problem
      like this one", with the exact answer and steps. Unlimited, for students and for professors making seminar or exam
      variants. Inputs without a min or max get a range around their default (half to double), so existing and
      AI-made calculators work without changes. The page's AI panel already has a **Practice problems** button that asks
      Claude: name the two apart, or let it use the calculator version when the page has calculators.
- [ ] **Problem and exam variants with an answer key:** a set of practice problems (or a whole exam) with different
      numbers per group or per student, and a separate key with the exact answers and steps (no AI; built on practice
      problems).
- [ ] **Step-through worked examples:** a calculator's step-by-step solution shown one step at a time, with each step's
      numbers filled in, so a newcomer can follow the method before trying it.
- [ ] **Common-mistakes notes:** a short note an assistant writes on a calculator or page ("forgot to convert to km"),
      shown when Check my working finds that mistake. Written by hand, so it costs no AI.
- [ ] **Notation sheet per lecture:** the symbols a lecture uses (μ, a, e, ν, h…) with their meaning and unit, collected
      from its formulas and calculator constants.
- [ ] **Notation consistency check:** across a course's lectures, a symbol used with two meanings or two units, or a
      term defined in one lecture and used differently in another (no AI; built on the notation sheet).
- [ ] **Presentation mode:** a page in full screen with large type and live orbit diagrams, so notes double as slides.
- [ ] **Printable handouts:** a page, a problem set (with its solutions on a separate sheet), or the exam formula sheet,
      as clean print or PDF output.
- [ ] **Course packs:** a course exported without personal data, for students to import as their own copy (built on
      backup).

### Writing and keeping your notes

- [ ] **Page export to LaTeX or Markdown,** formulas intact, as the start of a thesis chapter or a report.
- [ ] **Reference list from uploads:** the sources a page cites (its uploads and originals), as a list to paste into a
      thesis, and as BibTeX.
- [ ] **Readable export of all notes:** every course as Markdown with images, so the notes outlive the course and the
      app (backup already keeps everything, but only for restoring into the app).

### Claude outside the app

Still on request, with numbers still from your calculators. Work done in Claude Desktop or Claude Code uses your Claude
plan, not the app's API credits, so everyday questions about your notes cost the app nothing.

- [ ] **An MCP server for your own data:** note search, `find_calculators`, `run_calculator`, `show_orbit` and save to
      page. The chat tools already exist on the server; the MCP server exposes them, signed in as you.
- [ ] **Claude skills** for authoring the calculator JSON, the math style and the exam-plan file, so calculators and
      plans written outside the app import cleanly.

### Small fixes

- [ ] Phone-width check: the reading view, Lectures, the calculator runner and exam plans at 360–400 px.
- [ ] Split the remaining large files when they next change: `Wiki.tsx`, `PageView.tsx`, `Files.tsx` and
      `routes/pages.ts` (about 500 lines each).

### Reuse and modularity (deferred)

Most of Notecyclopedia is a general study system; the astrodynamics part (orbit maths and diagram, mission files,
presets, `show_orbit`, the μ check, the built-in useful links) is a smaller layer on top. These steps make the general
parts reusable and the field-specific parts pluggable.

Deferred until something outside the app needs them, such as the MCP server or a second subject: the calculator engine
is already split into modules inside `@nc/shared`, which gives most of the benefit now.

**Workspace packages** (split from `@nc/shared`, not published), so a page that needs one part loads only that part and
the tree-shaking override in `apps/web/vite.config.ts` can go:

- [ ] `@nc/calc`: calculator specs, the restricted math.js evaluator, unit checks, step-by-step solutions and the
      exports. The most reusable piece, useful to any engineering course or tool.
- [ ] `@nc/doc`: the page document (block ids, terms, references, links, `docToText`), the math converter and
      `tidyLatex`, and the read-only renderer.
- [ ] `@nc/orbit`: orbit maths (Kepler propagation, J2 rates, ground track, sidereal time, transfers, mission files),
      with no dependencies.
- [ ] `@nc/orbit-view`: the React orbit diagram and the coastline map, on top of `@nc/orbit`.
- [ ] `@nc/study`: study scheduling (study days, catching up, fitting before the exam) and the plan file format.

**Subject packs:** everything field-specific behind one interface, so another field is added without touching the core.

- [ ] A pack declares its built-in constants and presets, extra page widgets, AI tools, calculator rules, useful links
      and a short domain note for the prompts.
- [ ] Astrodynamics becomes the first pack.

**Publishing, only if someone else needs it:**

- [ ] Publish `@nc/calc`, `@nc/orbit` and `@nc/orbit-view`, or build a standalone orbit viewer page.

## Later: hosting for others

Courses can already be shared between accounts on one server. Running it for classmates needs:

- [ ] Deployment (for example Railway or Fly with managed Postgres) and a storage interface for uploads (local disk or
      R2).
- [ ] Password reset, email verification, rate limits and account deletion.

Then, for teaching with it:

- [ ] **Checking submitted answers:** students submit answers to a problem set, and the assistant sees them checked
      with the calculator's exact answer and the unit checks (no AI). Needs consent and a clear privacy note.
- [ ] **What students ask about:** the pages of a shared course that students ask the tutor about most, anonymised and
      only for students who opt in, so a professor sees which parts need more explanation.

## Dropped

- Question banks generated after every save, FSRS scheduling and a scheduled daily quiz: they turn the tool into
  homework and spend credits in the background. Daily questions are made only when you ask.

## Done

| Phase | What it brought |
|---|---|
| Groundwork ([#1](https://github.com/kSabchev/notecyclopedia/pull/1)–[#6](https://github.com/kSabchev/notecyclopedia/pull/6)) | CI, PDF articles, Claude usage admin, the visual calculator editor, course constants, portable formulas, Review & polish |
| 0 Foundations ([#7](https://github.com/kSabchev/notecyclopedia/pull/7)) | Retrieval by any word, stable formula ids, background indexing, the daily AI budget, prompt caching, revision history |
| 1 Widget blocks ([#8](https://github.com/kSabchev/notecyclopedia/pull/8), [#10](https://github.com/kSabchev/notecyclopedia/pull/10)) | Calculator, plot and image blocks; calculator theory, step-by-step solutions and Excel export |
| 2 Orbit diagram ([#9](https://github.com/kSabchev/notecyclopedia/pull/9)) | Kepler orbits in the plane and in 3D, presets, GMAT and FreeFlyer previews, `show_orbit` |
| 3 Tutor ([#12](https://github.com/kSabchev/notecyclopedia/pull/12)) | Tutor and Check my working, calculator tools in chat, a model per feature, cost per answer |
| Course structure ([#13](https://github.com/kSabchev/notecyclopedia/pull/13)) | Course sections, formulas by course, headings as terms, references, topic hubs |
| 4 Daily questions ([#14](https://github.com/kSabchev/notecyclopedia/pull/14)) | Today's question, expansions, questions on demand and by day |
| 5 Orbit speeds and physics ([#15](https://github.com/kSabchev/notecyclopedia/pull/15)) | Speeds to scale, a simulated clock, J2 drift, ground tracks with coastlines |
| 6 Help where you read ([#16](https://github.com/kSabchev/notecyclopedia/pull/16)) | Explain from a selection, Save to page, formula cards, backlinks |
| 7 Performance ([#17](https://github.com/kSabchev/notecyclopedia/pull/17)) | A reader without the editor, indexed search, stopping unread answers, caching across updates |
| 8 Study companion ([#18](https://github.com/kSabchev/notecyclopedia/pull/18)) | Where was I, exam prep plans, Check my understanding |
| Lectures and links ([#19](https://github.com/kSabchev/notecyclopedia/pull/19)) | Original lectures, the Lectures tab, views by lecture, useful links |
| Small fixes ([#20](https://github.com/kSabchev/notecyclopedia/pull/20)) | Upload search and paging, the backup reminder, μ as a calculator constant |
| Calculator library ([#21](https://github.com/kSabchev/notecyclopedia/pull/21)) | Personal calculators with a course tag, archive, duplicate, Rework with AI |
| Connected navigation ([#22](https://github.com/kSabchev/notecyclopedia/pull/22)) | Tasks, lectures, calculators and courses linked to each other |
| Readable math ([#23](https://github.com/kSabchev/notecyclopedia/pull/23)) | Inline math, one converter for AI text, the LaTeX tidy-up, Tidy formulas |
| Reuse, step 1 ([#24](https://github.com/kSabchev/notecyclopedia/pull/24)–[#28](https://github.com/kSabchev/notecyclopedia/pull/28)) | `callTool` and the prompts module, UI text per language, large files split with shared helpers, tests by area with coverage minimums in CI |
| Documentation ([#29](https://github.com/kSabchev/notecyclopedia/pull/29)–[#31](https://github.com/kSabchev/notecyclopedia/pull/31)) | A short README with the guide, configuration, development and roadmap in `docs/`, screenshots, the MIT licence |
| Polish ([#32](https://github.com/kSabchev/notecyclopedia/pull/32)–[#34](https://github.com/kSabchev/notecyclopedia/pull/34)) | Loading, error and not-found screens, toasts and confirm dialogs, the offline notice, AI tool activity, spinners only on the working row, Review & polish by section with both versions aligned |

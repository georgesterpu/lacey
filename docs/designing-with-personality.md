# A personal site with a point of view

## Handoff for agents refactoring George Sterpu’s blog

Written 15 November 2026. This is a portable design brief: copy the whole file into the blog repository’s `docs/` directory and refer to it in a future refactoring task. It documents a direction and a working method; it does not claim that the blog redesign has been implemented or validated.

**Goal:** make George’s website feel like a person worth spending time with: curious, thoughtful, technically capable, warm and occasionally funny. Give the writing, books, running and professional work a recognisable home. Preserve straightforward navigation and comfortable reading.

**Reference sites:**

- [George’s current site](https://georgesterpu.github.io/)
- [Blog repository](https://github.com/georgesterpu/georgesterpu.github.io)
- [Lacey](https://lacey.january.ie/), the running-shoe lookout that prompted this brief

Study Lacey’s friendliness, readable controls and small touches of character. Its shop cards, subscription journey, shoe jokes, name and purple palette belong to that product. The blog needs its own expression.

## 1. Know where these lessons came from

The strongest input was George’s direct feedback during Lacey’s development:

- The initial presentation felt generic and impersonal.
- A wash of green and weak text contrast made it unpleasant to read.
- Too much explanation, subtext and secondary navigation created unnecessary work.
- Men’s, women’s and kids’ needed a clear department label; “fit” was ambiguous.
- A small smile in an ordinary Lidl receipt felt more human than corporate boilerplate. This was George’s personal observation, not a study of supermarket technology.
- A memorable name, restrained colour, a friendly sign-off and occasional humour gave the product a more recognisable character.
- A beautiful confirmation screen still failed when the user could not tell whether an email had been sent or an alert was active.

These are project observations and stated preferences. We have not run a controlled usability study or established that a palette, mascot or emoji increases engagement. Keep proposed improvements distinct from measured results.

Published references are listed at the end. They support specific principles; they are not proof that George’s readers will like a particular redesign.

## 2. Start with the actual blog

Before editing, read the target repository’s current instructions and source. Do not assume this brief describes its latest state.

| Read | Why |
| --- | --- |
| `AGENTS.md` | Workspace, tooling, publication and preservation rules. |
| `README.md`, `package.json`, `bunfig.toml` | Actual commands and runtime requirements. |
| `docs/design.md` | Existing design rationale and professional positioning. |
| `docs/editing.md`, `docs/migration.json` | Content conventions and published URLs that must survive. |
| `docs/research/` | Boundaries for claims about work and research. |
| `src/data/profile.json` | Current public profile and contact copy. |
| Several real posts, book notes and running entries | George’s subjects, sentence rhythms, images and existing voice. |
| `src/layouts/SiteLayout.astro`, `src/components/`, `src/styles/` | Existing shared structure before adding alternatives. |

At the time of writing, the blog uses Astro static output, TypeScript, Bun, Markdown and self-hosted fonts. Its existing direction is “quiet editorial”, with Literata, DM Sans, warm white and restrained green. Its homepage gives professional work substantial priority.

George’s newer request is for a more personal, expressive **blog**. Treat the old palette and emphasis as decisions to reassess, not an immutable visual specification. Preserve the repository’s technical and content protections. The new request does not authorise inventing biography, altering research claims or silently removing the professional audience.

Follow the authorised checkout and publishing instructions for the environment you are actually in. Do not create a replacement history, upgrade the stack to make a visual change, or publish a redesign merely because a document is present.

## 3. Define a voice before choosing a theme

Use this working personality:

> Curious, warm, precise, lightly mischievous. Comfortable explaining something difficult and admitting what remains uncertain.

This describes a design direction, not a quotation attributed to George. Refine it against his real writing.

Choose a few observable behaviours:

- Prefer concrete first-person language and real subjects over impressive-sounding slogans.
- Let an interesting observation carry a sentence; keep introductions short.
- Make room for modest opinions and curiosity where the source material supports them.
- Use natural warmth in greetings, transitions and acknowledgements.
- Keep navigation and actions literal: **Writing**, **Books**, **About**, **RSS**, **Read the notes**.

Avoid manufacturing “authenticity”. Do not invent a childhood story, a favourite café, a race result, a personal quotation, a customer outcome or a philosophical belief to make the site charming. Do not rewrite published poems or essays into an agent’s house style as part of a visual refactor.

Voice can stay recognisable while tone changes. A research explanation needs precision; a running caption can be playful; a reflective poem may need quiet. Read the page before adding a smile.

## 4. Transfer the principle, adapt the expression

| Lacey lesson | Application to a personal blog |
| --- | --- |
| A memorable identity helps people remember the product. | Make George’s name, editorial choices and interests recognisable. A new brand name or mascot is optional, not a prerequisite. |
| Reduce the steps needed to save a watch. | Make an article easy to enter, read and leave for another piece. Avoid interrupting reading with prompts or modals. |
| Clear department and size labels prevent mistakes. | Use recognisable section names and distinguish an essay, work note, reading list and running entry. |
| A smiling sign-off adds warmth. | A short personal footer or occasional aside can carry warmth. It does not need to appear on every page. |
| One useful card beats repeated entries. | Give each piece a clear title and useful preview. Repeated thumbnails, badges and metadata should earn their space. |
| A cheerful status message must reflect reality. | Links, RSS, dates, navigation and any forms must work as labelled. Personality should reinforce trust. |
| Mobile readability matters to older adults too. | Build the article experience around comfortable text, clear links, spacing and large enough controls. |

A product often helps someone finish a task quickly. A blog also invites attention, reflection and exploration. “Don’t make me think” applies to finding and using the interface; thoughtful writing is allowed to be demanding.

## 5. Give the visuals an editorial idea

A useful starting concept is **an engineer’s notebook, with room for books and muddy shoes**. This is an internal design metaphor, not a required headline or an invented personal anecdote.

Translate it into a small set of deliberate choices:

- Clear, dark reading text on a quiet background.
- Expressive headings with a consistent rhythm, supported by an unobtrusive reading face.
- A distinctive accent chosen with the site’s actual photographs and book covers in view.
- One recurring detail, such as a small marginal annotation, a particular rule or a typographic signature.
- Layouts that suit their material: editorial rows for writing, covers for books, generous photographs for a running journal.

Explore two genuinely different directions briefly, then choose one with a reason tied to the content. Proceed to a concrete implementation within the requested scope; do not turn routine visual choices into repeated approval questions.

Keep successful existing choices where they help. A total font replacement is not evidence of a better design. Equally, changing only the accent colour will not solve a generic hierarchy or impersonal copy.

George’s objection to Lacey’s green treatment was about the overall effect: monotony, readability and a familiar generated appearance. It is not a universal ban on green. Lacey’s later purple is not a compulsory replacement. Choose and test a palette for this site.

## 6. Design the reading journey

### Homepage

Introduce George briefly and make worthwhile writing easy to find near the top. Offer a clear route to professional work, books, running and about/contact without presenting every interest as an equally loud feature card.

Reconsider the current balance between professional introduction and the notebook. Keep evidence of the work accessible. Do not assume that a personal blog must become either a résumé homepage or a product landing page.

Use actual titles, excerpts and images to establish personality. Avoid a very large slogan, a wall of skills, decorative metrics or repeated calls to action pushing the writing far down the page.

### Writing index

Help someone choose a piece: title first, a short honest excerpt, then useful date/topic information. Begin with a readable list. Add filtering or search when the amount of content warrants it; keep direct links usable without JavaScript.

### Article

Assume many readers arrive directly from a shared link. Show the title, relevant date and article promptly. Give the prose a comfortable measure. Make headings, quotations, lists, figures, captions, references and code blocks work together.

End with a modest route onward: another relevant piece, the writing index or RSS. A reader finishing an essay does not need a sales funnel.

### Books, running and work

Preserve their different purposes. A bookshelf benefits from covers with visible titles and authors; saved passages need room to read. Running photographs can be expressive without awkward crops or invented captions. Work pages should retain concrete evidence, credits and carefully scoped claims.

Shared typography and navigation should make these sections feel related. Their content does not need identical card layouts.

## 7. Let the copy smile naturally

The following are candidate examples for interface copy, not George-authored text and not instructions to replace his writing verbatim.

| Generic copy | A possible warmer treatment |
| --- | --- |
| “Explore my insights” | “Notes on things I’m trying to understand.” |
| “Content categories” | “What I’ve been writing about” |
| “Related content” | “Keep reading” |
| “Learn more about this project” | “Read how it works” |
| “Thank you for visiting” | “Thanks for reading. George 😊” |
| “404: An error has occurred” | “I couldn’t find that page. Browse the writing.” |

Evaluate every line in context. “Notes on things…” would be wrong if it understates a finished research paper. A smile may suit a personal footer and be inappropriate below a serious essay.

Use native emoji sparingly where they add warmth. Preserve meaningful words in labels, keep decorative marks out of accessible names, and accept that emoji presentation varies by browser. Do not replace every platform-dependent character with a custom illustration.

Prefer an optional human touch over forced humour. Readers should never have to decode a joke to navigate, understand an error or leave a subscription.

## 8. Make readability concrete

Use these as starting design settings, then inspect real content:

- Article text around **18–20 px**, approximately **1.55–1.75** line height and roughly **60–75 characters** per line.
- A compact type hierarchy with clear differences between title, headings, prose, captions and navigation.
- Useful spacing around headings and paragraphs, rather than large empty regions between every sentence.
- Links recognisable within prose, visible keyboard focus and comfortable touch controls. Around **44 px** is a practical target for primary controls, not a blanket statement of the WCAG minimum.
- A single-column reading layout on small screens. Let code and genuinely wide tables scroll locally rather than breaking the entire page.

These dimensions are design starting points, not standards or findings from a Lacey user study.

For text contrast, WCAG AA specifies at least **4.5:1** for ordinary text and **3:1** for qualifying large text. Check muted metadata too. Test text enlargement to **200%** without losing content or controls. See the W3C references below.

Use semantic headings, a skip link, useful image alternatives and reduced-motion preferences. Keep decoration optional. Preserve UTF-8, font fallbacks and working image paths: broken characters and missing images directly damage the intended experience.

## 9. Keep the implementation proportionate

Work with the static Astro structure. Prefer shared CSS tokens, semantic templates and the existing content collections. Add a reusable component when a meaningful pattern repeats; a one-off layout may remain a one-off.

Keep content in Markdown and profile data. Make adding a post, book or run a content edit, not a template surgery. Preserve published filenames, dates, anchors, topic routes, RSS and migration redirects. Respect image licences and the repository’s public/private content boundaries.

Do not add a framework, client-side rendering layer, animation package, login, newsletter service, analytics or CMS just to create a more personal appearance. Prefer HTML/CSS for simple decorative details. Any substantial new capability needs a reason grounded in the requested experience.

## 10. Inspect the result as a reader

Use the repository’s actual verification commands. Inspect real pages in a browser as well as running the build. A successful build does not establish that text is pleasant to read.

Check at least:

- A homepage, writing index, substantial article, book page and running entry.
- A phone-sized viewport and desktop; long titles and long words.
- Keyboard navigation, visible focus, 200% text enlargement and reduced motion.
- Image loading, sensible crops, font loading and Unicode rendering.
- Reading without JavaScript where the site supports it.
- Existing post links, anchors, RSS and the professional evidence pages.

Then make an editorial pass. Are there repeated explanations? Does the site sound like one person? Is there a distinctive choice that belongs to this material? Can a new reader find something to read without learning the interface?

Deliver a coherent visual pass, with representative desktop/mobile screenshots and a short explanation of the important choices. Describe remaining limitations honestly. Preserve any existing content-provenance disclosure until its accuracy has been reviewed; a nicer design does not make generated text personally authored.

## 11. Read these references with a specific question

1. [Mailchimp: Voice and tone](https://styleguide.mailchimp.com/voice-and-tone/). Learn how a recognisable voice adapts to the reader’s situation, and why forced jokes weaken communication. Develop George’s expression rather than imitating Mailchimp’s.
2. [Duolingo: Building character](https://blog.duolingo.com/building-character/). Look at coherent visual relationships and iterative character development. This does not imply the blog needs gamification, a mascot or animations.
3. [W3C WAI: Designing for web accessibility](https://www.w3.org/WAI/tips/designing/). Review navigation, feedback, grouping and viewport considerations while looking at actual pages.
4. [W3C: Contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [Resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html). Use these for the specific accessibility requirements above, rather than treating aesthetic preferences as compliance rules.
5. [Lacey](https://lacey.january.ie/). Inspect the live interface; if it is unavailable, use the project observations recorded here. Its design and functionality remain works in progress. Reuse the thinking, not its retail interface.
6. [The blog’s existing design document](https://github.com/georgesterpu/georgesterpu.github.io/blob/main/docs/design.md) and [agent instructions](https://github.com/georgesterpu/georgesterpu.github.io/blob/main/AGENTS.md). Reconcile the earlier direction with George’s newer brief before editing.

## 12. A prompt George can reuse

```text
Refactor the visuals of my personal blog using
`docs/designing-with-personality.md` as the design brief.

Read AGENTS.md, the current design notes and representative real content first.
Make the site recognisably mine: curious, warm, readable and occasionally playful.
Use Lacey as a reference for considerate interactions and small moments of character.
Design the blog around writing, books, running and evidence of my work.

Develop a coherent editorial direction and implement it across representative page
layouts. Keep labels clear and let each piece's tone guide the amount of humour.
Preserve my published writing, factual claims, URLs, RSS, accessibility and the static
architecture. Do not invent personal anecdotes or turn the site into a product funnel.

Validate the result in a browser on mobile and desktop and run the repository's checks.
Show representative screenshots and explain the choices. Follow the repository's
publishing rules; do not infer deployment permission from this design brief alone.
```

# UI design (first draft, Nov 19)

`screens.png` is Matt's and Nathan's first draft of how the app should look, drawn for an iPhone.
It shows two of the three main pages: **Tasks** (left) and **Classes** (right). The third, **Settings**,
isn't drawn: it uses the same style. Every other screen (unlock, setup, the slide viewer, "What was
covered?", the quiz, Play) is styled to match, with the same **"not too busy"** look as the two drawn.

The drawing isn't to scale: sizes are ours to choose (tap targets at least 44 px, text in fields at
least 16 px so the iPhone doesn't zoom). This README records what the drawing means, including the
answers to the questions it left open (Nathan, Nov 19). Where it says "our call", the person building
it chose, and Matt and Nathan may change it later.

![The Tasks and Classes screens](screens.png)

## Look

**Colours** (from Matt and Nathan, Nov 19):

| Name | Hex | Dark mode | Light mode |
| --- | --- | --- | --- |
| White | `#f2f5f1` | text | background |
| Green | `#9fe870` | accent: headings, outlines, progress fill, selected nav pill | fills only (progress, selected nav pill); text and outlines use the darker green below |
| Grey | `#272727` | background | text |

- **Light mode** (our call): background `#f2f5f1`, text `#272727`, green `#9fe870` for fills, and a
  darker green, about `#3b7d1a`, for green text and outlines, because `#9fe870` on a light background
  is too faint to read.
- **Theme setting:** Settings has **Phone / Light / Dark** (a button group, no dropdown); Phone, which
  follows the phone's setting, is the default. It's a device setting, kept in the browser rather
  than in the encrypted data, so the unlock screen has the right colours too.
- **Font:** none chosen yet. Our call: **Lexend**, which is free (OFL), rounded and geometric like the
  drawing, and made for easy reading. It's bundled with the app, never loaded from another site. It
  may change later.
- **Shapes:** rounded, with outlines more than filled boxes. Buttons are pill-shaped and outlined in
  green; the selected thing is filled green.

## Nav bar (all three main pages)

A pill-shaped bar at the bottom with three icons: **Tasks** (a house), **Classes** (a stack of books;
the `+` in the drawing was a placeholder) and **Settings** (a gear). The current page's icon is
dark grey (`#272727`) on a filled green rounded rectangle (white as drawn was too faint on green;
Nathan, Nov 19); the others are green outlines.

It moves (#143, #147, Matt, Nov 26): the green pill stays under the page you're on and slides to the new
page when you click or tap another. With a mouse, hovering over another icon draws a green ring around it;
the pill doesn't follow the mouse (that looked odd). A pressed button shrinks a little. Phones get no
hover ring, and nothing moves for someone who has turned on reduced motion.

## Page transitions (#149)

A new screen slides in a little (1.5rem) and fades in, quickly (0.24 s), from the side it comes from:
- between Tasks, Classes and Settings, in the nav bar's order (Settings comes in from the right after Tasks);
- deeper (a class, then What was covered?, the slides, a quiz, practice or Play) comes in from the right;
- back comes in from the left;
- between screens at the same depth, it only fades.

The header, the footer and the nav bar stay where they are. Only the new screen moves in: the old one doesn't
animate out, so tapping is never held up. Nothing moves for someone who has turned on reduced motion.

The nav bar is on the three main pages only. Full-screen screens (the slide viewer, a quiz, Play,
editing a class) hide it and have a back button instead (our call).

## Tasks (the home page)

Opens by default. Its job: see and finish today's review and quizzes.

When you come back after finishing a quiz, each new tick draws itself in with a small pop (#153, Matt, Nov 26):
the lecture's, its class's once all of it is done, and exam practice's. Ticks you've already seen stay still, and
so does everything on the first look after opening the app. Nothing moves with reduced motion.

- **Progress bar** at the top fills as today's work gets done. No times are shown anywhere any more,
  but the estimates from setting up a class are still used to weigh each class's share of the bar,
  with a quiz counting as about 10 questions' worth of time. While you're in a class's slides, the
  bar creeps forward a little, but that class's full share is only added once **all** its quizzes
  for today are done.
- **Start** (below the bar) reviews and quizzes everything, in the order the list shows.
- **One row per class** that has something today. A class with nothing today isn't listed. Each row is:
  - `::` on the left, a drag handle: press and hold it to drag the class up or down; the rest of
    the row scrolls normally. **The order is remembered**, for every later day too, and Start uses it.
  - the class name;
  - on the right, a very short status, 12 characters at most: **Exam soon** when an exam is near
    (our call: within 7 days); otherwise **New** if anything in it is new today; otherwise **Review**.
    When all its quizzes for today are done, a **checkmark** replaces the status.
  - Tapping anywhere on the row opens it, and tapping again closes it (`>` closed, `v` open). Open,
    it lists the class's lectures for today. Each lecture shows:
    - its **name**, which opens that lecture's slides;
    - **Quiz**, which starts that lecture's quiz. When the quiz is done, a checkmark replaces it.
  - A lecture counts as done when its quiz is done.
- **Nothing today:** when no class has anything, the page shows a happy placeholder picture of a
  studious penguin instead of the list (drawn as an SVG for the app, our call).

## Classes

- A heading for each class (e.g. **COMP 2000**), with a three-dots button on the right. (The `::`
  in the drawing means three dots here, not a drag handle.) The three dots open the class's menu:
  - edit what any lecture covered,
  - the class details (name, lecture days and times),
  - its exams,
  - the uploaded files,
  - deleting the class.
- Under each heading, one round button per lecture that hasn't been filled in yet (its slides and
  what was covered), labelled with its date (our call: `Nov 15`). They pile up while you're behind,
  wrapping onto more lines. Tapping one opens the upload screen for that lecture, as now: carry on in
  a PDF you already added, or upload a new one. Once it's filled in, its button disappears.
- A **+** at the bottom adds a class.

## Settings

Everything else, on one page, in the same style: the theme (above), daily study minutes, unlocking
(passkey, passphrase, recovery key), backups, Lock, AI sign-in, and Compare models (kept for now: the
app is still an MVP).

## Changes to how the app works (not just looks)

- **First-week quizzes default to 10 questions** instead of 5 (`RULES.firstWeekQuizSize`), with more
  or fewer depending on how much material was covered. Later quizzes are still sized by the score
  table (3, 5, 8 or 10) (Nathan, Nov 19).
- **No times shown to the user**; the estimates stay, for the planner and the progress bar.
- **Tasks are grouped by class** and their order is saved (see Tasks).
- **Classes lists unfilled lectures** as date buttons.

## Building it (planned order, one PR each)

1. Colours as CSS variables for dark and light, the theme setting, the font, the nav bar and
   the three pages behind it.
2. The Tasks page: rows by class, statuses, open and close, the saved order with drag, the
   penguin, and the new progress bar.
3. The Classes page and the class menu.
4. Settings on one page.
5. Restyle the other screens to match.
6. The quiz size change (with `docs/DESIGN.md` updated in the same PR).

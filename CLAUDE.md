# Personal Site - Code Structure & Context

## Project Overview
A minimal landing page for Nicholas Moschopoulos (nimo) featuring a text scrambler animation with glitch effects. Built with React 19, TypeScript, and vanilla CSS.

**Current State**: Ultra-minimal single landing page with scrambler animation and streaming subtitle.
**Previous State**: Full site with multiple routes (NFTs, Investing, Photos, Connect, About) and Chakra UI - all removed.

## Tech Stack
- **React 19.2.0** - Latest UI framework (upgraded from 17)
- **TypeScript 5.9.3** - Latest with strict type safety (upgraded from 4.4)
- **Vanilla CSS** - No UI framework (removed Chakra UI for simplicity)
- **Create React App 5.0.0** - Build tooling
- **Node 22.21.0** - Runtime (specified in .nvmrc)
- **Yarn 1.22.22** - Package manager

## Project Structure

```
personal-site/
├── public/                    # Static assets
│   ├── index.html            # HTML entry point
│   ├── favicon.png           # Site favicon
│   ├── manifest.json         # PWA manifest
│   └── robots.txt            # SEO crawling rules
│
├── src/
│   ├── index.tsx             # React app entry point (React 19 API)
│   ├── index.css             # Global styles and animations
│   ├── App.tsx               # Main app component
│   │
│   ├── components/           # React components
│   │   ├── TextScrambler.tsx    # Main scrambler component
│   │   └── StreamingText.tsx    # LLM-style streaming text component
│   │
│   ├── hooks/                # Custom React hooks
│   │   └── useScrambledText.ts  # Text scrambling logic
│   │
│   └── utils/                # Utility functions
│       └── textScramble.ts      # Text scrambling algorithm
│
├── .nvmrc                    # Node version specification (22.21.0)
├── CLAUDE.md                 # This file - project documentation
├── package.json              # Dependencies & scripts (minimal deps)
├── tsconfig.json             # TypeScript configuration
└── yarn.lock                 # Dependency lock file
```

## Key Components & Files

### Active Components

#### `src/App.tsx`
**Purpose**: Main application component
**Current Implementation**: Ultra-minimal landing page
- Shows full name scrambler first
- Transitions to "nimo" with glitch effect
- Subtitle streams in character by character
- Final state: glitching "nimo" + hyperlinked subtitle
- No routing, no navigation, no UI framework

**Animation Flow**:
1. "nicholas moschopoulos" scrambles in
2. After completion, shows "nimo" with glitch effect
3. Subtitle streams in like an LLM response
4. Subtitle gets replaced with final version with Junior link

#### `src/components/TextScrambler.tsx`
**Purpose**: Text scrambling animation component
**How it works**:
1. Takes a `text` prop (e.g., "nicholas moschopoulos")
2. Uses `useScrambledText` hook to animate scrambling effect
3. After scramble completes, calls callback after 500ms
4. Renders as plain `<h1>` with configurable className

**Key Props**:
- `text: string` - The text to scramble
- `callback: () => void` - Called when animation completes
- `className?: string` - CSS class (defaults to 'scrambler')

**Implementation Details**:
- Pure function component with hooks
- Uses useEffect to trigger callback when scrambling completes
- No UI framework dependencies

#### `src/components/StreamingText.tsx`
**Purpose**: LLM-style streaming text component
**How it works**:
1. Receives full text to display
2. Reveals one character at a time at configurable speed
3. Calls onComplete callback when done
4. Mimics ChatGPT/Claude streaming effect

**Key Props**:
- `text: string` - The full text to stream
- `speed?: number` - Milliseconds per character (default: 30)
- `className?: string` - CSS class
- `onComplete?: () => void` - Called when streaming finishes

**Implementation Details**:
- Uses useState for displayedText and currentIndex
- useEffect with setTimeout for character-by-character reveal
- Returns undefined from useEffect to satisfy ESLint rules

#### `src/hooks/useScrambledText.ts`
**Purpose**: Hook that manages text scrambling state
**Algorithm**:
1. Starts with random characters via `getRandomString`
2. Every 50ms, updates to new scrambled state via `getNewText`
3. Gradually reveals correct characters based on iteration count
4. Stops when scrambled text matches target text

**Key Functions**:
- `updateText()` - Recursively updates scrambled state with setTimeout
- Uses refs (`scrambledTextRef`, `countRef`) to track current state without re-rendering
- Cleans up timeout on unmount

**Key State**:
- `scrambledText` - Current displayed text (state)
- `count` - Iteration count for probability calculation (state)
- `scrambledTextRef` - Ref to current text for timeout callback
- `countRef` - Ref to current count for timeout callback

#### `src/utils/textScramble.ts`
**Purpose**: Core scrambling algorithm
**Key Constants**:
- `SCRAMBLE_CHARS = '!<>-_\\/[]{}—=+*^?#'` - Characters used for scrambling
- `INDEX_FOR_CORRECT_CHAR = 1000` - Probability modifier for revealing chars

**Key Functions**:
- `getRandomChar()` - Returns random scramble character
- `getRandomString(textLength)` - Generates initial random string (5-textLength chars)
- `getNewText(count, oldText, finalText)` - Generates next scrambled state
  - Uses probability based on iteration count to reveal correct chars
  - Uses position-based probability to determine when to change chars
  - Maintains already-correct characters

#### `src/index.css`
**Purpose**: All styling and animations
**Key Sections**:
1. **Global Resets** - Zero margin/padding, border-box
2. **Body Styles** - Black background, white text, Roboto font
3. **Layout Classes** - `.app` (flex center), `.content` (vertical stack)
4. **Text Styles** - `.scrambler` (Roboto Mono, 2rem)
5. **Glitch Effect** - `.nimo-glitch` with pseudo-elements and animations
6. **Subtitle Styles** - Gray text with link hover states

**Glitch Animation**:
- Three keyframe animations: `glitch`, `glitchTop`, `glitchBottom`
- Main element skews and translates
- `::before` pseudo-element: clips top 33%, animates independently
- `::after` pseudo-element: clips bottom 33%, animates independently
- Creates layered RGB-split glitch effect
- Runs infinitely in a loop

#### `src/index.tsx`
**Purpose**: React app entry point
**Key Changes**:
- Uses React 19's `createRoot` API (not legacy `ReactDOM.render`)
- Removed ChakraProvider and theme
- Removed QueryClientProvider
- Just wraps App in StrictMode

## Animation Flow

### Complete User Experience
1. **Page Load**: Black screen, white text
2. **Initial Scramble**: "nicholas moschopoulos" scrambles in character by character (~2-3 seconds)
3. **Transition**: Brief pause (500ms)
4. **Nimo Appears**: "nimo" appears with glitch effect (skewing, layered)
5. **Subtitle Streams**: "adventurer, cook, and founder of Junior" types in character by character (~1.6 seconds at 40ms/char)
6. **Final State**: Static "nimo" with glitch + clickable subtitle with "Junior" hyperlink

### Scrambling Algorithm Details
- Random characters cycle at 50ms intervals
- Probability of revealing correct character increases with each iteration
- Characters closer to the start reveal faster (position-based probability)
- Already-correct characters are locked and don't change
- Creates cascading "solving" effect from left to right

### Glitch Animation Details
- Main text element: skews and translates continuously
- Before pseudo-element: clips top third (0-33%), moves with different timing
- After pseudo-element: clips bottom third (67-100%), moves with different timing
- Combined effect creates RGB-split layered glitch
- Uses CSS keyframes, no JavaScript
- Runs at different speeds: 0.5s (main & top), 1.5s (bottom)

### Streaming Text Details
- Reveals text at 40ms per character (configurable via props)
- After streaming completes, replaces with final JSX including hyperlink
- Mimics LLM response behavior
- Uses setTimeout loop, not requestAnimationFrame

## Development Patterns

### TypeScript Patterns
- Strict typing throughout
- Props defined with explicit `type` declarations
- Function components with typed props
- No `any` types
- Proper handling of optional props with default values and defaultProps

### React Patterns
- React 19 features (createRoot)
- Functional components only (no class components)
- Custom hooks for shared logic
- useEffect for side effects and lifecycle
- useState/useRef for state management
- Callbacks passed as props for component communication
- Proper cleanup of timeouts in useEffect

### Styling Patterns
- Vanilla CSS in single index.css file
- CSS custom properties not used (keeping it simple)
- Keyframe animations for glitch effect
- No CSS-in-JS libraries
- No styled-components or Emotion
- Standard CSS classes
- Responsive design not needed for single centered element

### File Organization
- Minimal structure: components/, hooks/, utils/
- No theme directory (removed with Chakra UI)
- No routes directory (removed)
- No test files (removed)
- Everything needed is in 5 files: App.tsx, TextScrambler.tsx, StreamingText.tsx, useScrambledText.ts, textScramble.ts

## Build & Deployment

### Available Scripts
- `yarn start` - Start development server (port 3000)
- `yarn build` - Create production build
- `yarn eject` - Eject from CRA (not recommended)

### Build Output
- Production build goes to `build/` directory
- **Main bundle: ~61 KB gzipped** (down from 135 KB with Chakra UI)
- **CSS bundle: ~1.3 KB gzipped**
- Optimized for hosting on static file servers
- Massive bundle size improvement after removing Chakra UI

### Environment
- Node version enforced via `.nvmrc`: `22.21.0`
- Package manager: Yarn 1.22.22
- Build tool: Create React App 5.0.0
- No custom webpack configuration (using CRA defaults)
- No test framework configured

## Design Decisions

### Why Remove Chakra UI?
User requested removal - it was overkill for a simple landing page. Replaced with 70 lines of vanilla CSS. Bundle size reduced by 52%.

### Why Upgrade to React 19?
Latest version with all new features. No reason to stay on old version for simple site.

### Why Remove All Testing?
No tests existed, testing libraries were dead weight. Simple site doesn't need test infrastructure.

### Why Streaming Subtitle?
User requested "stream in like an LLM value" - creates modern AI-app aesthetic that matches the glitch/technical vibe.

### Why Keep Glitch Effect?
User specifically liked it and requested it back. Adds personality and technical aesthetic. Pure CSS, no performance impact.

### Why Black Background?
User preference. Changed from blue to fully black minimal design.

### Why Remove All Routes?
User wanted to simplify and prevent random people from booking calls via Calendly. Now just a landing page.

## Recent Major Changes

### v3.0 - Complete Refactor (Latest)
- **Removed**: Chakra UI, Emotion, framer-motion, all testing libraries
- **Upgraded**: React 17 → 19, TypeScript 4.4 → 5.9.3
- **Added**: Vanilla CSS, StreamingText component
- **Changed**: index.tsx to use React 19's createRoot API
- **Result**: Bundle size -52%, cleaner codebase, modern stack

### v2.0 - Cleanup
- Removed all unused routes, components, hooks, utils
- Removed unused dependencies (kbar, wouter, react-calendly, etc.)
- Deleted theme directory
- Added CLAUDE.md documentation

### v1.0 - Simplification
- Removed full site navigation
- Simplified to single landing page
- Changed color scheme from blue to black
- Added node version configuration

## Dependencies

### Production Dependencies (Minimal!)
```json
{
  "@fontsource/roboto": "^4.5.3",
  "@fontsource/roboto-mono": "^4.5.3",
  "react": "^19.2.0",
  "react-dom": "^19.2.0",
  "react-scripts": "5.0.0",
  "web-vitals": "^2.1.0"
}
```

### Dev Dependencies
```json
{
  "@types/node": "^16.7.13",
  "@types/react": "^19.2.2",
  "@types/react-dom": "^19.2.2",
  "@typescript-eslint/eslint-plugin": "^5.12.0",
  "@typescript-eslint/parser": "^5.12.0",
  "eslint": "^8.9.0",
  "eslint-config-airbnb": "^19.0.4",
  "eslint-config-prettier": "^8.4.0",
  "eslint-import-resolver-typescript": "^2.5.0",
  "eslint-plugin-import": "^2.25.4",
  "eslint-plugin-prettier": "^4.0.0",
  "eslint-plugin-react": "^7.28.0",
  "prettier": "^2.5.1",
  "typescript": "^5.9.3"
}
```

## Notes for AI Assistants

### Current Active Code
Only these files matter for functionality:
- `src/App.tsx` - Main component with animation orchestration
- `src/components/TextScrambler.tsx` - Scrambling animation
- `src/components/StreamingText.tsx` - Streaming text effect
- `src/hooks/useScrambledText.ts` - Scrambling logic
- `src/utils/textScramble.ts` - Scrambling algorithm
- `src/index.css` - All styles and animations
- `src/index.tsx` - React 19 entry point

### Making Changes
- **Animations**: Modify timing in App.tsx or algorithms in textScramble.ts
- **Styling**: Edit index.css (single file, ~120 lines)
- **Text Content**: Change in App.tsx
- **Glitch Effect**: Edit keyframes in index.css
- **Streaming Speed**: Adjust `speed` prop in App.tsx (currently 40ms/char)

### Testing Changes
- Always run `yarn build` to verify changes compile
- Check for TypeScript errors
- Check for ESLint errors (build will fail if errors exist)
- No test suite to run

### Commit Style
- Descriptive commit messages
- Explain "why" not just "what"
- Reference specific files changed
- Note bundle size impacts

### Common Tasks

**Change scrambling characters**:
Edit `SCRAMBLE_CHARS` in `src/utils/textScramble.ts`

**Change scrambling speed**:
Change timeout value in `src/hooks/useScrambledText.ts` (currently 50ms)

**Change streaming speed**:
Change `speed` prop in `src/App.tsx` StreamingText component (currently 40ms)

**Change glitch animation**:
Edit `@keyframes glitch`, `glitchTop`, `glitchBottom` in `src/index.css`

**Change colors**:
Edit color values in `src/index.css` (background: #000, text: #fff, subtitle: #9ca3af)

**Change fonts**:
Fonts are from @fontsource packages. To change, update imports in index.tsx and CSS

**Add new animation**:
Create new component like StreamingText.tsx, add keyframes to index.css if needed

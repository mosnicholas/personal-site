# Personal Site - Code Structure & Context

## Project Overview
A minimal landing page for Nicholas Moschopoulos (nimo) featuring a text scrambler animation. Built with React, TypeScript, and Chakra UI.

**Current State**: Simplified to a single landing page with scrambler animation only.
**Previous State**: Full site with multiple routes (NFTs, Investing, Photos, Connect, About) - now removed.

## Tech Stack
- **React 17.0.2** - UI framework
- **TypeScript 4.9.5** - Type safety
- **Chakra UI 1.8.9** - Component library & styling
- **Emotion 11** - CSS-in-JS for animations
- **Framer Motion 6** - Animation library
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
│   ├── index.tsx             # React app entry point
│   ├── App.tsx               # Main app component (ACTIVE)
│   ├── Page.tsx              # Page wrapper (UNUSED - routes removed)
│   │
│   ├── components/           # React components
│   │   ├── TextScrambler.tsx           # Main scrambler component (ACTIVE)
│   │   ├── TextCycler.tsx              # Text cycling animation
│   │   ├── Footer.tsx                  # Footer component (UNUSED)
│   │   ├── NFTCard.tsx                 # NFT display card (UNUSED)
│   │   ├── InvestingSection.tsx        # Investment section (UNUSED)
│   │   ├── Header/                     # Header navigation (UNUSED)
│   │   │   ├── index.tsx
│   │   │   └── NavLink.tsx
│   │   ├── KBarSearch/                 # Command palette search (UNUSED)
│   │   │   ├── index.tsx
│   │   │   └── ResultItem.tsx
│   │   └── Layout/                     # Layout components (UNUSED)
│   │       ├── RouteWrapper.tsx
│   │       └── ImageGrid.tsx
│   │
│   ├── hooks/                # Custom React hooks
│   │   ├── useScrambledText.ts         # Text scrambling logic (ACTIVE)
│   │   ├── useKBarActions.ts           # KBar actions (UNUSED)
│   │   ├── useNFTs.ts                  # NFT data fetching (UNUSED)
│   │   └── usePhotos.ts                # Photo data fetching (UNUSED)
│   │
│   ├── routes/               # Route components (ALL UNUSED - routes removed)
│   │   ├── Home.tsx
│   │   ├── About.tsx
│   │   ├── Connect.tsx       # Had Calendly integration
│   │   ├── Photos.tsx
│   │   ├── NFTs.tsx
│   │   └── Investing.tsx
│   │
│   ├── theme/                # Chakra UI theme configuration
│   │   ├── index.ts          # Theme entry point
│   │   ├── styles.ts         # Global styles (bg: black)
│   │   ├── semanticTokens.ts # Semantic color tokens
│   │   └── components/       # Component-specific theme overrides
│   │       ├── index.ts
│   │       └── Link.ts       # Link styles (colorScheme: gray)
│   │
│   └── utils/                # Utility functions
│       ├── textScramble.ts              # Text scrambling algorithm (ACTIVE)
│       ├── generateGlitchAnimation.ts   # Glitch animation generator (ACTIVE)
│       ├── queryClient.ts               # React Query client (UNUSED)
│       ├── consts.ts                    # Constants
│       └── types.ts                     # TypeScript types
│
├── .nvmrc                    # Node version specification (22.21.0)
├── .claudeme                 # Claude context file
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript configuration
└── yarn.lock                 # Dependency lock file
```

## Key Components & Files

### Active Components (Currently Used)

#### `src/App.tsx`
**Purpose**: Main application component
**Current Implementation**: Simplified landing page with scrambler only
- Shows centered TextScrambler component
- After scramble completes, shows subtitle with fade-in
- Subtitle: "adventurer, cook, and founder of myjunior.ai"
- No routing, no navigation, just the landing animation

**Previous Implementation**:
- Used to check route with `wouter`
- Conditionally rendered KBarProvider with Page component (all routes)
- Had command palette (KBar) integration

#### `src/components/TextScrambler.tsx`
**Purpose**: Text scrambling animation component
**How it works**:
1. Takes a `text` prop ("nicholas moschopoulos")
2. Uses `useScrambledText` hook to animate scrambling effect
3. After scramble completes, shows "nimo" with glitch animation
4. After 1.5s, removes glitch and calls callback
5. Renders as Chakra UI `Heading` with Roboto Mono font

**Key Props**:
- `text: string` - The text to scramble
- `callback: () => void` - Called when animation completes

**Commented Code**: Lines 26-29 show previous "nimo.eth" transition (now removed)

#### `src/hooks/useScrambledText.ts`
**Purpose**: Hook that manages text scrambling state
**Algorithm**:
1. Starts with random characters via `getRandomString`
2. Every 50ms, updates to new scrambled state via `getNewText`
3. Gradually reveals correct characters based on iteration count
4. Stops when scrambled text matches target text

**Key Functions**:
- `updateText()` - Recursively updates scrambled state
- Uses refs to track current state without re-rendering

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

#### `src/utils/generateGlitchAnimation.ts`
**Purpose**: Creates CSS-in-JS glitch effect
**How it works**:
- Defines 3 keyframe animations: `glitch`, `glitchTop`, `glitchBottom`
- Returns Chakra UI style props with animations
- Uses `_before` and `_after` pseudo-elements for layered glitch effect
- Each layer animated independently with different timing

#### `src/theme/styles.ts`
**Purpose**: Global Chakra UI styles
**Key Styles**:
- `body.bg: 'black'` - Sets background to fully black
- `body.fontFamily: 'Roboto, sans serif'` - Default font
- `body.letterSpacing: '1.2px'` - Increased letter spacing

#### `src/theme/components/Link.ts`
**Purpose**: Link component theme customization
**Key Change**: Default `colorScheme` changed from `'messenger'` (blue) to `'gray'`

### Unused Components (Legacy - Not Currently Rendered)

The following components still exist in the codebase but are not currently used since the site was simplified:

#### Route Components (`src/routes/*`)
- `Home.tsx` - Original home page
- `About.tsx` - About page with bio
- `Connect.tsx` - Contact page with Calendly integration (removed to prevent bookings)
- `Photos.tsx` - Photo gallery
- `NFTs.tsx` - NFT collection display
- `Investing.tsx` - Investment portfolio/projects

#### Navigation Components
- `Header/index.tsx` - Main navigation header
- `Header/NavLink.tsx` - Navigation link component
- `Footer.tsx` - Footer with social links

#### Search Components
- `KBarSearch/index.tsx` - Command palette search interface
- `KBarSearch/ResultItem.tsx` - Search result item component

#### Layout Components
- `Layout/RouteWrapper.tsx` - Route page wrapper
- `Layout/ImageGrid.tsx` - Grid layout for images

#### Other Components
- `NFTCard.tsx` - Individual NFT display card
- `InvestingSection.tsx` - Investment section
- `TextCycler.tsx` - Text cycling animation

#### Unused Hooks
- `useKBarActions.ts` - Command palette actions
- `useNFTs.ts` - Fetches NFT data from blockchain
- `usePhotos.ts` - Fetches photo data

## Animation Flow

### Current App Flow
1. **Initial State**: Page loads with black background
2. **Scrambler Starts**: TextScrambler begins with random characters
3. **Text Resolves**: "nicholas moschopoulos" gradually appears (~2-3 seconds)
4. **Transition to nimo**: Changes to "nimo" (750ms after resolution)
5. **Glitch Effect**: "nimo" glitches for 1.5 seconds
6. **Show Subtitle**: Subtitle fades in with "adventurer, cook, and founder of myjunior.ai"
7. **Final State**: Static display with name and subtitle

### Scrambling Algorithm Details
- Random characters cycle at 50ms intervals
- Probability of revealing correct character increases with each iteration
- Characters closer to the start of the string reveal faster
- Already-correct characters are locked and don't change
- Creates a cascading "solving" effect from left to right

### Glitch Animation Details
- Main text element skews and translates
- Before pseudo-element: clips top third, moves independently
- After pseudo-element: clips bottom third, moves independently
- Combined effect creates layered RGB-split glitch aesthetic
- Uses Emotion's `keyframes` for CSS animations

## Development Patterns

### TypeScript Patterns
- Strict typing throughout
- Props defined with explicit `type` declarations
- React component types: `React.FC<Props>` or function components with typed props

### React Patterns
- Functional components only (no class components)
- Custom hooks for shared logic
- useEffect for side effects and lifecycle
- useState/useRef for state management
- Callbacks passed as props for component communication

### Styling Patterns
- Chakra UI components for base UI
- Emotion for custom CSS-in-JS animations
- Theme customization via `theme/` directory
- Responsive design via Chakra's breakpoint props (e.g., `pt={{ base: 20, md: 0 }}`)
- Color scheme system (currently simplified to gray)

### File Organization
- Components in `components/` with co-located subcomponents in subdirectories
- Custom hooks in `hooks/`
- Utilities in `utils/`
- Theme configuration in `theme/`
- Routes in `routes/` (legacy)

## Build & Deployment

### Available Scripts
- `yarn start` - Start development server (port 3000)
- `yarn build` - Create production build
- `yarn test` - Run tests
- `yarn eject` - Eject from CRA (not recommended)

### Build Output
- Production build goes to `build/` directory
- Main bundle: `~135 KB` gzipped
- CSS bundle: `~765 B` gzipped
- Optimized for hosting on static file servers

### Environment
- Node version enforced via `.nvmrc`: `22.21.0`
- Package manager: Yarn 1.22.22
- Build tool: Create React App 5.0.0
- No custom webpack configuration (using CRA defaults)

## Design Decisions

### Why Remove Routes?
User wanted to simplify the site and prevent random people from booking calls via the Calendly integration on the Connect page.

### Why Black Background?
User preference changed from blue aesthetic to fully black minimal design.

### Why Keep Legacy Components?
Components remain in codebase for potential future reactivation. They're not imported in App.tsx so they don't affect bundle size (tree-shaking).

### Why Scrambler Animation?
Creates unique, memorable first impression. Technical aesthetic fits with web3/developer identity.

## Future Considerations

### Potential Improvements
- Clean up unused components and dependencies
- Upgrade to React 18
- Consider upgrading Chakra UI to v2+
- Remove unused dependencies (kbar, wouter, react-calendly, react-query, react-scroll-parallax)
- Add meta tags for better social sharing
- Add analytics if needed

### Dependency Cleanup Opportunities
The following are no longer needed given the simplified single-page design:
- `kbar` - Command palette (no longer rendered)
- `wouter` - Routing (no routes)
- `react-calendly` - Calendar integration (removed intentionally)
- `react-query` - Data fetching (no API calls)
- `react-scroll-parallax` - Parallax effects (not used)
- `bignumber.js` - Big number math (was for NFT/crypto features)

## Notes for AI Assistants

### Making Changes
- **Active code**: Focus changes on `App.tsx`, `TextScrambler.tsx`, `useScrambledText.ts`, and theme files
- **Legacy code**: Don't remove unless explicitly asked - it's kept for reference
- **Theme changes**: Modify files in `src/theme/` directory
- **Animation changes**: Update timing in `TextScrambler.tsx` or algorithms in `utils/textScramble.ts`

### Testing Changes
- Always run `yarn build` to verify changes compile
- Check TypeScript errors with build process
- No test suite currently active

### Commit Style
- Descriptive commit messages
- Explain "why" not just "what"
- Reference specific files changed
